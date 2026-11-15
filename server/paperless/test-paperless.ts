import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * Nachgebautes Paperless-ngx für Tests (Vitest und E2E): die Routen der REST-API, die Belegt liest, nach
 * src/paperless/urls.py und src/documents/views.py. Token-Prüfung wie TokenAuthentication („Authorization: Token …“,
 * sonst 401), Seiten wie StandardPagination ({count, next, previous, results}; eine Seite hinter dem Ende ist 404),
 * Notizen mit verschachteltem Benutzer (NotesSerializer), Prüfsumme in /metadata/ (original_checksum) und Download mit
 * original=true (sonst die Archivversion). Erfundene Daten, kein Code aus Paperless-ngx.
 */

export interface TestDokument {
  id: number;
  title: string;
  correspondent?: number | null;
  document_type?: number | null;
  tags?: number[];
  created?: string;
  archive_serial_number?: number | null;
  original_file_name?: string;
  notes?: { id: number; note: string; created: string; user: { id: number; username: string } | null }[];
  custom_fields?: { field: number; value: unknown }[];
  original: Uint8Array;
  /** Prüfsumme, die Paperless-ngx nennt; ohne Angabe der SHA-256 des Originals */
  checksum?: string;
}

export interface TestPaperless {
  url: string;
  token: string;
  tags: { id: number; name: string }[];
  correspondents: { id: number; name: string }[];
  document_types: { id: number; name: string }[];
  custom_fields: { id: number; name: string; data_type: string; extra_data: unknown }[];
  dokumente: TestDokument[];
  /** Pfade (Anfang), die mit 302 auf diese Adresse weiterleiten */
  umleiten: Map<string, string>;
  /** Jede Anfrage: Pfad mit Abfrage, Authorization, Accept */
  anfragen: { pfad: string; authorization: string | undefined; accept: string | undefined }[];
  /** Vor jedem Download (Tests brechen damit ab) */
  beimDownload?: (id: number) => Promise<void> | void;
  beenden(): Promise<void>;
}

function seite<T>(req: IncomingMessage, u: URL, liste: T[], res: ServerResponse, hoechstens = 100000) {
  const nummer = Number(u.searchParams.get("page") ?? 1);
  // max_page_size kürzt page_size (StandardPagination); Tests setzen eine kleine Grenze, um zu blättern
  const groesse = Math.min(Number(u.searchParams.get("page_size") ?? 25), hoechstens);
  const start = (nummer - 1) * groesse;
  if (nummer < 1 || (start >= liste.length && nummer > 1)) return json(res, 404, { detail: "Invalid page." });
  // next nimmt den Host aus der Anfrage, wie Django; Belegt baut seine Adressen trotzdem selbst
  const naechste = new URL(u.toString().replace(/^http:\/\/[^/]+/, `http://${req.headers.host}`));
  naechste.searchParams.set("page", String(nummer + 1));
  return json(res, 200, {
    count: liste.length,
    next: start + groesse < liste.length ? naechste.toString() : null,
    previous: nummer > 1 ? "…" : null,
    all: liste.map((_, i) => i),
    results: liste.slice(start, start + groesse),
  });
}

function json(res: ServerResponse, status: number, daten: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(daten));
}

type Optionen = Partial<
  Pick<TestPaperless, "tags" | "correspondents" | "document_types" | "custom_fields" | "dokumente">
> & {
  token?: string;
  /** Notizen nur über /api/documents/:id/notes/, nicht in der Liste (ältere Versionen) */
  notizenEinzeln?: boolean;
  /** Größte Seite, die der Server liefert */
  seitenGroesse?: number;
  /** Fester Port (E2E); sonst ein freier */
  port?: number;
};

/** Die Liste der Dokumente wie DocumentSerializer, mit fields nur diese Felder */
function dokumentListe(p: Omit<TestPaperless, "url" | "beenden">, daten: Optionen, u: URL) {
  const felder = u.searchParams.get("fields")?.split(",");
  return [...p.dokumente]
    .sort((a, b) => a.id - b.id)
    .map(({ original: _, checksum: __, ...d }) => {
      const voll: Record<string, unknown> = {
        correspondent: null,
        document_type: null,
        tags: [],
        created: "2026-01-01",
        archive_serial_number: null,
        custom_fields: [],
        content: "Text, den Belegt nicht braucht",
        ...d,
        notes: daten.notizenEinzeln ? undefined : (d.notes ?? []),
      };
      return felder ? Object.fromEntries(Object.entries(voll).filter(([k]) => felder.includes(k))) : voll;
    });
}

/** Metadaten, Notizen oder Datei eines Dokuments */
async function einzeln(
  p: Omit<TestPaperless, "url" | "beenden">,
  d: TestDokument,
  was: string,
  u: URL,
  res: ServerResponse,
) {
  if (was === "metadata")
    return json(res, 200, {
      original_checksum: d.checksum ?? createHash("sha256").update(d.original).digest("hex"),
      original_size: d.original.length,
      original_filename: d.original_file_name,
      has_archive_version: true,
    });
  if (was === "notes") return json(res, 200, d.notes ?? []);
  await p.beimDownload?.(d.id);
  // Ohne original=true die Archivversion (DocumentViewSet.original_requested)
  const original = u.searchParams.get("original") === "true";
  res.writeHead(200, {
    "content-type": original ? "application/octet-stream" : "application/pdf",
    "content-disposition": `attachment; filename="${d.original_file_name ?? `${d.id}.pdf`}"`,
  });
  res.end(original ? Buffer.from(d.original) : Buffer.from(`%PDF-1.7 Archivversion ${d.id}`));
}

export async function testPaperless(daten: Optionen = {}): Promise<TestPaperless> {
  const p: Omit<TestPaperless, "url" | "beenden"> = {
    token: daten.token ?? "paperless-test-token",
    tags: daten.tags ?? [],
    correspondents: daten.correspondents ?? [],
    document_types: daten.document_types ?? [],
    custom_fields: daten.custom_fields ?? [],
    dokumente: daten.dokumente ?? [],
    umleiten: new Map(),
    anfragen: [],
  };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://paperless.test");
    p.anfragen.push({ pfad: req.url ?? "", authorization: req.headers.authorization, accept: req.headers.accept });
    for (const [anfang, ziel] of p.umleiten) {
      if (u.pathname.startsWith(anfang)) {
        res.writeHead(302, { location: ziel });
        return res.end();
      }
    }
    if (req.headers.authorization !== `Token ${p.token}`) return json(res, 401, { detail: "Invalid token." });
    const pfad = u.pathname;
    if (pfad === "/api/tags/") return seite(req, u, p.tags, res, daten.seitenGroesse);
    if (pfad === "/api/correspondents/") return seite(req, u, p.correspondents, res, daten.seitenGroesse);
    if (pfad === "/api/document_types/") return seite(req, u, p.document_types, res, daten.seitenGroesse);
    if (pfad === "/api/custom_fields/") return seite(req, u, p.custom_fields, res, daten.seitenGroesse);
    if (pfad === "/api/documents/") return seite(req, u, dokumentListe(p, daten, u), res, daten.seitenGroesse);
    const treffer = /^\/api\/documents\/(\d+)\/(metadata|download|notes)\/$/.exec(pfad);
    if (treffer) {
      const d = p.dokumente.find((x) => x.id === Number(treffer[1]));
      return d
        ? einzeln(p, d, treffer[2]!, u, res)
        : json(res, 404, { detail: "No Document matches the given query." });
    }
    json(res, 404, { detail: "Not found." });
  });
  await new Promise<void>((fertig) => server.listen(daten.port ?? 0, "127.0.0.1", fertig));
  const { port } = server.address() as AddressInfo;
  return Object.assign(p, {
    url: `http://127.0.0.1:${port}`,
    beenden: () => new Promise<void>((fertig) => server.close(() => fertig())),
  }) as TestPaperless;
}
