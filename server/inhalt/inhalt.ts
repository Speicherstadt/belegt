import { eq, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { inhalte } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { type ERechnung, eRechnungLesen } from "./erechnung.ts";

/** So viel Text wird höchstens gespeichert; für die Suche reicht das, das Original bleibt vollständig */
const MAX_TEXT = 1_000_000;

/** Namen eingebetteter E-Rechnungen: ZUGFeRD 1 und 2, Factur-X und XRechnung im PDF */
const EINGEBETTET = /^(factur-x|zugferd-invoice|ZUGFeRD-invoice|xrechnung)\.xml$/i;

export interface Gelesen {
  text: string;
  erechnung: ERechnung | null;
}

async function pdfLesen(bytes: Uint8Array): Promise<Gelesen> {
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
    return { text: text.slice(0, MAX_TEXT), erechnung };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Liest Text und E-Rechnung aus einer Datei; Bilder und anderes ergeben leeren Text */
export async function lesen(bytes: Uint8Array, mimeType: string): Promise<Gelesen> {
  if (mimeType === "application/pdf") return pdfLesen(bytes);
  if (mimeType === "application/xml") {
    const xml = new TextDecoder().decode(bytes);
    return { text: "", erechnung: eRechnungLesen(xml) };
  }
  return { text: "", erechnung: null };
}

/**
 * Liest die Inhalte der Dokumente, die noch keine haben (PDF und XML, nicht gelöscht). Läuft im Worker, damit der
 * Upload schnell bleibt und jeder Weg ins Archiv erfasst ist. Ein Fehler wird festgehalten, damit dieselbe Datei
 * nicht in jedem Lauf wieder scheitert.
 */
export async function inhalteErzeugen({ db, speicher }: Umgebung, { stapel = 20 }: { stapel?: number } = {}) {
  const offen = await db.execute<{ id: string; sha256: string; mime_type: string }>(sql`
    select d.id, d.sha256, d.mime_type from dokumente d
     where d.mime_type in ('application/pdf', 'application/xml')
       and not exists (select 1 from inhalte i where i.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am limit ${stapel}`);
  let gelesen = 0;
  let fehler = 0;
  for (const d of offen) {
    try {
      const bytes = await speicher.laden(d.sha256);
      const g = await lesen(new Uint8Array(bytes), d.mime_type);
      await db.insert(inhalte).values({ dokumentId: d.id, text: g.text, erechnung: g.erechnung });
      gelesen++;
    } catch (err) {
      await db
        .insert(inhalte)
        .values({ dokumentId: d.id, fehler: err instanceof Error ? err.message.slice(0, 500) : "Nicht lesbar" })
        .onConflictDoNothing();
      fehler++;
    }
  }
  return { gelesen, fehler };
}

export async function inhaltZu(db: Umgebung["db"], dokumentId: string) {
  const [i] = await db
    .select({ erechnung: inhalte.erechnung, fehler: inhalte.fehler, textLaenge: sql<number>`length(${inhalte.text})` })
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
