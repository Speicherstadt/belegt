import { eq, sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { kiVorschlaege } from "../db/schema.ts";
import { inhaltZu, textZu } from "../inhalt/inhalt.ts";
import { mailZuDokument } from "../mail/import.ts";
import { type Abfragen, type KiKonfig, KiVorschlag, kiFragen } from "./ki.ts";

/**
 * Erzeugt Vorschläge für Dokumente im Eingang (nicht eingeordnet, nicht gelöscht), sobald ihr Inhalt gelesen ist. Läuft
 * im Worker; ein Fehler wird festgehalten, damit dasselbe Dokument nicht in jedem Lauf wieder scheitert.
 */
export async function kiVorschlaegeErzeugen(
  db: Datenbank,
  konfig: KiKonfig,
  { stapel = 5, abfragen }: { stapel?: number; abfragen?: Abfragen } = {},
) {
  const offen = await db.execute<{ id: string; dateiname: string | null; mime_type: string; eingegangen_am: Date }>(sql`
    select d.id, d.dateiname, d.mime_type, d.eingegangen_am from dokumente d
     where not exists (select 1 from einordnungen e where e.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
       and not exists (select 1 from ki_vorschlaege k where k.dokument_id = d.id)
       -- PDFs, XML und Bilder erst, wenn der Worker ihren Text gelesen hat
       and (d.mime_type not in ('application/pdf', 'application/xml', 'image/jpeg', 'image/png', 'image/webp')
            or exists (select 1 from inhalte i where i.dokument_id = d.id))
     order by d.eingegangen_am limit ${stapel}`);
  let erzeugt = 0;
  let fehler = 0;
  for (const d of offen) {
    try {
      const [mail, inhalt, text] = await Promise.all([
        mailZuDokument(db, d.id),
        inhaltZu(db, d.id),
        textZu(db, d.id, 0, 6000),
      ]);
      const vorschlag = await kiFragen(
        {
          dateiname: d.dateiname,
          typ: d.mime_type,
          eingang: new Date(d.eingegangen_am).toISOString().slice(0, 10),
          mail: mail ? { von: mail.von, betreff: mail.betreff, text: mail.text } : null,
          text: text?.text ?? "",
          erechnung: inhalt?.erechnung
            ? {
                nummer: inhalt.erechnung.nummer,
                datum: inhalt.erechnung.datum,
                verkaeufer: inhalt.erechnung.verkaeufer,
              }
            : null,
        },
        konfig,
        abfragen,
      );
      await db.insert(kiVorschlaege).values({ dokumentId: d.id, vorschlag, modell: konfig.modell });
      erzeugt++;
    } catch (err) {
      const meldung = (err instanceof Error ? err.message : "KI nicht erreichbar").split("\n")[0]!.slice(0, 300);
      await db
        .insert(kiVorschlaege)
        .values({ dokumentId: d.id, modell: konfig.modell, fehler: meldung })
        .onConflictDoNothing();
      fehler++;
    }
  }
  return { erzeugt, fehler };
}

export async function kiVorschlagZu(db: Datenbank, dokumentId: string) {
  const [k] = await db.select().from(kiVorschlaege).where(eq(kiVorschlaege.dokumentId, dokumentId));
  if (!k?.vorschlag) return null;
  const v = KiVorschlag.safeParse(k.vorschlag);
  return v.success ? { ...v.data, modell: k.modell } : null;
}
