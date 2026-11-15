import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { dokumenttypen, kiVorschlaege, tags } from "../db/schema.ts";
import { ALTE_OFFICE_TYPEN } from "../dokumente/dateityp.ts";
import { inhaltZu, LESBAR, textZu } from "../inhalt/inhalt.ts";
import { mailZuDokument } from "../mail/import.ts";
import { type Abfragen, type KiKonfig, KiVorschlag, kiFragen } from "./ki.ts";

const ALTE_TYPEN = sql`array[${sql.join(
  Object.values(ALTE_OFFICE_TYPEN).map((m) => sql`${m}`),
  sql`, `,
)}]::text[]`;

/**
 * Erzeugt Vorschläge für Dokumente im Eingang (nicht eingeordnet, nicht gelöscht), sobald ihr Inhalt gelesen ist. Läuft
 * im Worker; ein Fehler wird festgehalten, damit dasselbe Dokument nicht in jedem Lauf wieder scheitert. Den Text alter
 * Office-Formate (.doc, .xls, .ppt, .rtf) gibt es nur aus der Ansicht: Mit vorschau (VORSCHAU_URL gesetzt) wartet der
 * Vorschlag auf sie, ohne käme er nie.
 */
export async function kiVorschlaegeErzeugen(
  db: Datenbank,
  konfig: KiKonfig,
  { stapel = 5, abfragen, vorschau = false }: { stapel?: number; abfragen?: Abfragen; vorschau?: boolean } = {},
) {
  const offen = await db.execute<{ id: string; dateiname: string | null; mime_type: string; eingegangen_am: Date }>(sql`
    select d.id, d.dateiname, d.mime_type, d.eingegangen_am from dokumente d
     where not exists (select 1 from einordnungen e where e.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
       and not exists (select 1 from ki_vorschlaege k where k.dokument_id = d.id)
       -- Was der Worker liest (PDF, XML, Office, Text, Bilder), erst, wenn sein Text da ist
       and (not d.mime_type = any(${sql`array[${sql.join(
         [...LESBAR, "image/jpeg", "image/png", "image/webp"].map((m) => sql`${m}`),
         sql`, `,
       )}]::text[]`})
            or exists (select 1 from inhalte i where i.dokument_id = d.id))
       -- Alte Office-Formate mit Vorschau-Dienst, erst wenn die Ansicht da ist (mit Text) oder scheiterte
       and (not ${vorschau} or not d.mime_type = any(${ALTE_TYPEN})
            or exists (select 1 from ansichten a where a.dokument_id = d.id))
     order by d.eingegangen_am limit ${stapel}`);
  let erzeugt = 0;
  let fehler = 0;
  // Das Modell wählt nur aus vorhandenen Tags und Dokumenttypen (höchstens je 200)
  const auswahl = offen.length
    ? {
        tags: (await db.select({ name: tags.name }).from(tags).orderBy(asc(tags.name)).limit(200)).map((t) => t.name),
        dokumenttypen: (
          await db.select({ name: dokumenttypen.name }).from(dokumenttypen).orderBy(asc(dokumenttypen.name)).limit(200)
        ).map((t) => t.name),
      }
    : undefined;
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
          auswahl,
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

/**
 * Der Vorschlag mit Tags und Dokumenttyp, wie es sie heute gibt (IDs und Farben); was seitdem gelöscht wurde, fällt weg
 */
export async function kiVorschlagZu(db: Datenbank, dokumentId: string) {
  const [k] = await db.select().from(kiVorschlaege).where(eq(kiVorschlaege.dokumentId, dokumentId));
  if (!k?.vorschlag) return null;
  const v = KiVorschlag.safeParse(k.vorschlag);
  if (!v.success) return null;
  const namen = (v.data.tags ?? []).map((t) => t.toLowerCase());
  const [t, typ] = await Promise.all([
    namen.length
      ? db
          .select({ id: tags.id, name: tags.name, farbe: tags.farbe })
          .from(tags)
          .where(inArray(sql`lower(${tags.name})`, namen))
      : [],
    v.data.dokumenttyp
      ? db
          .select({ id: dokumenttypen.id, name: dokumenttypen.name })
          .from(dokumenttypen)
          .where(sql`lower(${dokumenttypen.name}) = lower(${v.data.dokumenttyp})`)
      : [],
  ]);
  const { tags: _t, dokumenttyp: _d, ...rest } = v.data;
  return {
    ...rest,
    modell: k.modell,
    ordnung: t.length || typ[0] ? { tags: t, dokumenttyp: typ[0] ?? null, felder: [] } : null,
  };
}
