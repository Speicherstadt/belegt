import { eq, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { inhalte } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { type ERechnung, eRechnungLesen, speicherbar } from "./erechnung.ts";
import { bildText, ocrVerfuegbar, pdfScanText } from "./ocr.ts";

/** So viel Text wird höchstens gespeichert; für die Suche reicht das, das Original bleibt vollständig */
const MAX_TEXT = 1_000_000;

/** Namen eingebetteter E-Rechnungen: ZUGFeRD 1 und 2, Factur-X und XRechnung im PDF */
const EINGEBETTET = /^(factur-x|zugferd-invoice|ZUGFeRD-invoice|xrechnung)\.xml$/i;

export interface Gelesen {
  text: string;
  erechnung: ERechnung | null;
  /** Text aus der Texterkennung */
  ocr?: boolean;
}

/** Bilder, die Tesseract liest; HEIC nicht */
const BILDER = ["image/jpeg", "image/png", "image/webp"];

/** Ein PDF mit so wenig Text ist ein Scan */
const OHNE_TEXT = (text: string) => text.replace(/\s/g, "").length < 20;

/** Gekürzt auf MAX_TEXT, ohne Zeichen, die Postgres nicht speichert (speicherbar) */
const fuerDatenbank = (text: string) => speicherbar(text.slice(0, MAX_TEXT));

async function pdfLesen(bytes: Uint8Array, ocr: boolean): Promise<Gelesen> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    let erechnung: ERechnung | null = null;
    // pdf.js liefert erst die Namen; den Inhalt holt getAttachmentContent, nur für Namen einer E-Rechnung
    for (const [id, a] of (await pdf.getAttachments()) ?? []) {
      if (!EINGEBETTET.test(a.filename || id)) continue;
      const inhalt = a.content ?? (await pdf.getAttachmentContent(id));
      erechnung = inhalt ? eRechnungLesen(new TextDecoder().decode(inhalt)) : null;
      if (erechnung) break;
    }
    if (ocr && OHNE_TEXT(text)) return { text: fuerDatenbank(await pdfScanText(bytes)), erechnung, ocr: true };
    return { text: fuerDatenbank(text), erechnung };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Liest Text und E-Rechnung aus einer Datei. Mit ocr gehen Bilder und PDFs ohne Text durch die Texterkennung, sonst
 * ergeben sie leeren Text.
 */
export async function lesen(bytes: Uint8Array, mimeType: string, { ocr = false } = {}): Promise<Gelesen> {
  if (mimeType === "application/pdf") return pdfLesen(bytes, ocr);
  if (ocr && BILDER.includes(mimeType))
    return { text: fuerDatenbank(await bildText(bytes)), erechnung: null, ocr: true };
  if (mimeType === "application/xml") {
    const xml = new TextDecoder().decode(bytes);
    return { text: "", erechnung: eRechnungLesen(xml) };
  }
  return { text: "", erechnung: null };
}

/**
 * Liest die Inhalte der Dokumente, die noch keine haben (PDF und XML, mit Texterkennung auch Bilder; nicht gelöscht).
 * Kommt die Texterkennung später dazu, liest es Scans und Bilder ohne Text noch einmal. Läuft im Worker, damit der
 * Upload schnell bleibt und jeder Weg ins Archiv erfasst ist. Ein Fehler wird festgehalten, damit dieselbe Datei
 * nicht in jedem Lauf wieder scheitert.
 */
export async function inhalteErzeugen(
  { db, speicher }: Umgebung,
  { stapel = 20, ocr = ocrVerfuegbar() }: { stapel?: number; ocr?: boolean } = {},
) {
  const bilder = sql`array[${sql.join(
    BILDER.map((b) => sql`${b}`),
    sql`, `,
  )}]::text[]`;
  const offen = await db.execute<{ id: string; sha256: string; mime_type: string }>(sql`
    select d.id, d.sha256, d.mime_type from dokumente d
      left join inhalte i on i.dokument_id = d.id
     where (d.mime_type in ('application/pdf', 'application/xml') or (${ocr} and d.mime_type = any(${bilder})))
       and (i.dokument_id is null
            or (${ocr} and not i.ocr and i.fehler is null and d.mime_type <> 'application/xml'
                and length(regexp_replace(i.text, '[[:space:]]', '', 'g')) < 20))
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am limit ${stapel}`);
  let gelesen = 0;
  let fehler = 0;
  for (const d of offen) {
    try {
      const bytes = await speicher.laden(d.sha256);
      const g = await lesen(new Uint8Array(bytes), d.mime_type, { ocr });
      const werte = { text: g.text, erechnung: g.erechnung, ocr: g.ocr ?? false, fehler: null, erzeugtAm: new Date() };
      await db
        .insert(inhalte)
        .values({ dokumentId: d.id, ...werte })
        .onConflictDoUpdate({ target: inhalte.dokumentId, set: werte });
      gelesen++;
    } catch (err) {
      // Die Meldung eines Datenbankfehlers enthält die Parameter, also den Text; sie gehört nicht in die Zeile
      const meldung = speicherbar(
        (err instanceof Error && !(err.cause || "code" in err) ? err.message : "Nicht lesbar")
          .split("\n")[0]!
          .slice(0, 500),
      );
      await db
        .insert(inhalte)
        .values({ dokumentId: d.id, fehler: meldung })
        .onConflictDoUpdate({ target: inhalte.dokumentId, set: { fehler: meldung } });
      fehler++;
    }
  }
  return { gelesen, fehler };
}

export async function inhaltZu(db: Umgebung["db"], dokumentId: string) {
  const [i] = await db
    .select({
      erechnung: inhalte.erechnung,
      fehler: inhalte.fehler,
      ocr: inhalte.ocr,
      textLaenge: sql<number>`length(${inhalte.text})`,
    })
    .from(inhalte)
    .where(eq(inhalte.dokumentId, dokumentId));
  return i ? { ...i, erechnung: i.erechnung as ERechnung | null, textLaenge: Number(i.textLaenge) } : null;
}

/** Ein Ausschnitt des gelesenen Texts, für Programme, die nicht alles auf einmal brauchen */
export async function textZu(db: Umgebung["db"], dokumentId: string, von = 0, laenge = 20_000) {
  const [i] = await db
    .select({
      text: sql<string>`substr(${inhalte.text}, ${von + 1}, ${laenge})`,
      gesamt: sql<number>`length(${inhalte.text})`,
    })
    .from(inhalte)
    .where(eq(inhalte.dokumentId, dokumentId));
  return i ? { text: i.text, von, gesamt: Number(i.gesamt) } : null;
}
