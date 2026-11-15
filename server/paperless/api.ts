import { MAX_UPLOAD } from "../http/gemeinsam.ts";
import type { PaperlessFeld } from "./abbildung.ts";
import type { PaperlessDokument } from "./kern.ts";
import { jsonLesen, optionenAus, waehrungAus } from "./manifest.ts";

/*
 * REST-API von Paperless-ngx, nur lesend (src/paperless/urls.py, src/documents/views.py, serialisers.py). Anmeldung mit
 * „Authorization: Token …“ (rest_framework.authentication.TokenAuthentication in src/paperless/settings), die Version per
 * Accept-Kopf (AcceptHeaderVersioning, erlaubt 9 und 10). Listen kommen seitenweise ({count, results}, page und
 * page_size, StandardPagination in src/paperless/views.py). Das Token geht nur an die eingetragene Adresse: Belegt baut
 * jede Adresse selbst aus ihr (nicht aus „next“, das den Host aus der Anfrage nimmt) und folgt Weiterleitungen nur auf
 * denselben Origin.
 */

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

const SEITE = 100;
const MAX_WEITERLEITUNGEN = 5;
const MAX_JSON = 50 * 1024 * 1024;

/** Felder eines Dokuments, die Belegt braucht; ohne content, der groß sein kann (fields, DocumentViewSet) */
const DOKUMENTFELDER = [
  "id",
  "title",
  "correspondent",
  "document_type",
  "tags",
  "created",
  "archive_serial_number",
  "original_file_name",
  "notes",
  "custom_fields",
].join(",");

/** Fehler mit einer Meldung für die Oberfläche; nie mit Token oder Antwort des Servers */
const fehler = (meldung: string) => new Error(meldung);

/** Liest höchstens max Bytes aus einer Antwort, ohne mehr in den Speicher zu holen */
async function bytesBis(res: Response, max: number): Promise<Uint8Array> {
  const laenge = Number(res.headers.get("content-length") ?? 0);
  if (laenge > max) throw fehler(`Datei größer als ${Math.round(max / 1024 / 1024)} MB`);
  const leser = res.body?.getReader();
  if (!leser) return new Uint8Array();
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > max) {
      await leser.cancel();
      throw fehler(`Datei größer als ${Math.round(max / 1024 / 1024)} MB`);
    }
    teile.push(value);
  }
  const b = new Uint8Array(summe);
  let pos = 0;
  for (const t of teile) {
    b.set(t, pos);
    pos += t.byteLength;
  }
  return b;
}

export interface PaperlessApi {
  /** Alle Felder, Namen von Tags, Korrespondenten und Dokumenttypen und die Zahl der Dokumente */
  bestand(): Promise<{ felder: PaperlessFeld[]; namen: Namen; anzahl: number }>;
  /** Eine Seite Dokumente (ab 1), aufsteigend nach ID */
  seite(nummer: number, namen: Namen): Promise<{ dokumente: PaperlessDokument[]; weiter: boolean }>;
  /** Prüfsumme und Original eines Dokuments, nie die Archivversion */
  original(d: PaperlessDokument): Promise<{ pruefsumme: string | null; bytes: Uint8Array }>;
}

export interface Namen {
  tags: Map<number, string>;
  korrespondenten: Map<number, string>;
  typen: Map<number, string>;
}

/** Normalisiert die eingegebene Adresse: http(s), ohne Abfrage und ohne „/“ am Ende; sonst null */
export function adresseAus(eingabe: string): string | null {
  try {
    const u = new URL(eingabe.trim());
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "").replace(/\/api$/, "")}`;
  } catch {
    return null;
  }
}

type Seite<T> = { count?: number; results?: T[]; next?: string | null };

/** Ein Dokument, wie es die Liste liefert (DocumentSerializer mit fields) */
type Roh = {
  id: number;
  title?: string | null;
  correspondent?: number | null;
  document_type?: number | null;
  tags?: number[];
  created?: string | null;
  archive_serial_number?: number | null;
  original_file_name?: string | null;
  notes?: RohNotiz[];
  custom_fields?: { field: number; value: unknown }[];
};

/** Eine Notiz (NotesSerializer): der Benutzer verschachtelt, bei älteren Versionen nur seine ID */
type RohNotiz = { note: string; created?: string; user?: { username?: string } | number | null };

/** Ein Dokument aus der Liste mit Namen statt IDs */
function dokumentAus(r: Roh, notizen: RohNotiz[], n: Namen): PaperlessDokument {
  return {
    id: r.id,
    titel: r.title ?? null,
    korrespondent: r.correspondent ? (n.korrespondenten.get(r.correspondent) ?? null) : null,
    dokumenttyp: r.document_type ? (n.typen.get(r.document_type) ?? null) : null,
    tags: (r.tags ?? []).flatMap((t) => (n.tags.has(t) ? [n.tags.get(t)!] : [])),
    created: r.created ?? null,
    asn: typeof r.archive_serial_number === "number" ? r.archive_serial_number : null,
    dateiname: r.original_file_name ?? null,
    pruefsumme: null,
    notizen: notizen.map((x) => ({
      text: String(x.note ?? ""),
      autor: typeof x.user === "object" && x.user ? (x.user.username ?? null) : null,
      erstellt: x.created ?? null,
    })),
    felder: (r.custom_fields ?? []).map((c) => ({ feldId: c.field, wert: c.value })),
  };
}

/** HTTP zur eingetragenen Adresse: mit Token und Version, Weiterleitungen nur auf denselben Origin */
function abfrager({ url, token, abfragen }: { url: string; token: string; abfragen: Abfragen }) {
  const herkunft = new URL(url).origin;

  async function holen(pfad: string, zeit = 30_000): Promise<Response> {
    let ziel = `${url}${pfad}`;
    for (let i = 0; i <= MAX_WEITERLEITUNGEN; i++) {
      const res = await abfragen(ziel, {
        headers: { authorization: `Token ${token}`, accept: "application/json; version=9" },
        redirect: "manual",
        signal: AbortSignal.timeout(zeit),
      }).catch((err: Error) => {
        throw fehler(
          `Paperless-ngx nicht erreichbar (${err.name === "TimeoutError" ? "Zeitüberschreitung" : err.message})`,
        );
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const ort = res.headers.get("location");
        const naechstes = ort ? new URL(ort, ziel) : null;
        // Das Token darf nur an die eingetragene Adresse gehen, nie an einen anderen Host
        if (!naechstes || naechstes.origin !== herkunft)
          throw fehler(`Weiterleitung auf einen anderen Host abgelehnt (${naechstes?.host ?? "ohne Ziel"})`);
        ziel = naechstes.toString();
        continue;
      }
      if (!res.ok) await res.body?.cancel();
      if (res.status === 401 || res.status === 403) throw fehler(`Paperless-ngx lehnt das Token ab (${res.status})`);
      if (!res.ok) throw fehler(`Paperless-ngx antwortet ${res.status} auf ${pfad.split("?")[0]}`);
      return res;
    }
    throw fehler("Zu viele Weiterleitungen");
  }

  async function json<T>(pfad: string): Promise<T> {
    const res = await holen(pfad);
    try {
      return jsonLesen(new TextDecoder().decode(await bytesBis(res, MAX_JSON))) as T;
    } catch {
      throw fehler(`Paperless-ngx: keine gültige Antwort auf ${pfad.split("?")[0]}`);
    }
  }

  /** Alle Seiten einer Liste; „next“ sagt nur, ob es weitergeht, die Adresse baut Belegt selbst */
  async function alle<T>(pfad: string): Promise<T[]> {
    const liste: T[] = [];
    for (let n = 1; ; n++) {
      const s = await json<Seite<T>>(`${pfad}?page=${n}&page_size=${SEITE}`);
      liste.push(...(s.results ?? []));
      if (!s.next || !s.results?.length || n > 10_000) return liste;
    }
  }

  return { holen, json, alle };
}

export function paperlessApi({
  url,
  token,
  abfragen = (u, init) => fetch(u, init),
}: {
  url: string;
  token: string;
  abfragen?: Abfragen;
}): PaperlessApi {
  const { holen, json, alle } = abfrager({ url, token, abfragen });
  const namen = async (pfad: string) =>
    new Map((await alle<{ id: number; name: string }>(pfad)).map((x) => [x.id, String(x.name)]));

  return {
    async bestand() {
      const [tags, korrespondenten, typen, rohFelder, erste] = await Promise.all([
        namen("/api/tags/"),
        namen("/api/correspondents/"),
        namen("/api/document_types/"),
        alle<{ id: number; name: string; data_type: string; extra_data: unknown }>("/api/custom_fields/"),
        json<Seite<unknown>>("/api/documents/?page=1&page_size=1&fields=id"),
      ]);
      const felder = rohFelder.map((f) => ({
        id: f.id,
        name: String(f.name),
        typ: String(f.data_type),
        optionen: optionenAus(f.extra_data),
        waehrung: waehrungAus(f.extra_data),
      }));
      return { felder, namen: { tags, korrespondenten, typen }, anzahl: Number(erste.count ?? 0) };
    },

    async seite(nummer, n) {
      const s = await json<Seite<Roh>>(
        `/api/documents/?page=${nummer}&page_size=${SEITE}&ordering=id&fields=${DOKUMENTFELDER}`,
      );
      const dokumente = await Promise.all(
        (s.results ?? []).map(async (r) => {
          // Ohne notes in der Liste (ältere Versionen) die eigene Route der Notizen
          const notizen = Array.isArray(r.notes) ? r.notes : await json<unknown>(`/api/documents/${r.id}/notes/`);
          return dokumentAus(r, Array.isArray(notizen) ? notizen : [], n);
        }),
      );
      return { dokumente, weiter: Boolean(s.next) && dokumente.length > 0 };
    },

    async original(d) {
      // original_checksum aus metadata und die Datei mit original=true beziehen sich auf dieselbe (neueste) Version
      // (DocumentViewSet.metadata, file_response mit original_requested)
      const meta = await json<{ original_checksum?: string | null }>(`/api/documents/${d.id}/metadata/`);
      const res = await holen(`/api/documents/${d.id}/download/?original=true`, 120_000);
      return { pruefsumme: meta.original_checksum ?? null, bytes: await bytesBis(res, MAX_UPLOAD) };
    },
  };
}
