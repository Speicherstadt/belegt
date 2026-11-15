import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { archivfassungen } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { speicherbar } from "../inhalt/erechnung.ts";
import { ausfuehren, ocrVerfuegbar } from "../inhalt/ocr.ts";
import { type Fassung, MAX_ARCHIVFASSUNG } from "./erzeugen.ts";

/*
 * Durchsuchbare Fassung (PDF/A-2b) für Scans, erzeugt im Worker: für jedes Dokument, dessen Text aus der Texterkennung
 * kommt (Bilder und PDFs ohne Textebene, server/inhalt/) und die dabei Text hatten; ein Foto ohne Text bekommt keine,
 * durchsuchbar wäre daran nichts. Abgeleitet wie die Ansicht; maßgeblich bleibt das Original,
 * das unverändert im Speicher liegt. Mit ARCHIVFASSUNG=false oder ohne Tesseract gibt es keine.
 */

const KIND = fileURLToPath(new URL("./archiv-kind.ts", import.meta.url));

const nichtErreichbar = (meldung: string) => Object.assign(new Error(meldung), { nichtErreichbar: true });

/**
 * Die Archivfassung in einem eigenen Bun-Prozess in eigener Prozessgruppe: Nach dem Zeitlimit endet er mit pdftoppm
 * und Tesseract, die er gestartet hat; ein Scan, an dem Tesseract hängt, hält so nicht den Worker auf.
 */
export async function archivfassungImKind(
  bytes: Uint8Array,
  mimeType: string,
  zeitlimit = 10 * 60_000,
): Promise<Fassung> {
  const aus = await ausfuehren("bun", [KIND, mimeType, String(zeitlimit)], bytes, zeitlimit, { gruppe: true });
  const e = JSON.parse(aus) as { fehler?: string; seiten?: number; pdf?: string };
  if (e.fehler || !e.pdf || !e.seiten) throw new Error(e.fehler ?? "Keine Archivfassung");
  const pdf = new Uint8Array(Buffer.from(e.pdf, "base64"));
  if (pdf.byteLength > MAX_ARCHIVFASSUNG) throw new Error("Archivfassung zu groß");
  return { pdf, seiten: e.seiten };
}

/**
 * Erzeugt Archivfassungen für Scans ohne, die nicht gelöscht sind. Ein Fehler der Datei wird festgehalten, damit sie
 * nicht in jedem Lauf wieder scheitert; fehlt der Speicher kurz, endet der Lauf ohne Eintrag. Ohne Tesseract: nichts.
 */
export async function archivfassungenErzeugen(
  { db, speicher }: Umgebung,
  { stapel = 3, zeitlimit }: { stapel?: number; zeitlimit?: number } = {},
) {
  if (!ocrVerfuegbar()) return { erzeugt: 0, fehler: 0 };
  const offen = await db.execute<{ id: string; sha256: string; mime_type: string }>(sql`
    select d.id, d.sha256, d.mime_type from dokumente d
      join inhalte i on i.dokument_id = d.id and i.ocr and i.text ~ '[^[:space:]]'
     where not exists (select 1 from archivfassungen a where a.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am limit ${stapel}`);
  let erzeugt = 0;
  let fehler = 0;
  for (const d of offen) {
    let fassung: Fassung;
    try {
      const bytes = await speicher.laden(d.sha256).catch(() => {
        throw nichtErreichbar("Speicher nicht erreichbar");
      });
      fassung = await archivfassungImKind(new Uint8Array(bytes), d.mime_type, zeitlimit);
    } catch (err) {
      if (err instanceof Error && "nichtErreichbar" in err) return { erzeugt, fehler, meldung: err.message };
      const meldung = speicherbar(
        (err instanceof Error ? err.message : "Keine Archivfassung").split("\n")[0]!.slice(0, 300),
      );
      await db.insert(archivfassungen).values({ dokumentId: d.id, fehler: meldung }).onConflictDoNothing();
      fehler++;
      continue;
    }
    await db
      .insert(archivfassungen)
      .values({ dokumentId: d.id, pdf: Buffer.from(fassung.pdf), seiten: fassung.seiten })
      .onConflictDoNothing();
    erzeugt++;
  }
  return { erzeugt, fehler };
}

/** Die Archivfassung eines Dokuments als PDF, null ohne (kein Scan, noch nicht erzeugt, nicht möglich) */
export async function archivfassungZu(db: Umgebung["db"], dokumentId: string): Promise<Uint8Array | null> {
  const [a] = await db
    .select({ pdf: archivfassungen.pdf })
    .from(archivfassungen)
    .where(eq(archivfassungen.dokumentId, dokumentId));
  return a?.pdf ? new Uint8Array(a.pdf) : null;
}

export async function hatArchivfassung(db: Umgebung["db"], dokumentId: string): Promise<boolean> {
  const [a] = await db
    .select({ da: sql<boolean>`${archivfassungen.pdf} is not null` })
    .from(archivfassungen)
    .where(eq(archivfassungen.dokumentId, dokumentId));
  return a?.da ?? false;
}
