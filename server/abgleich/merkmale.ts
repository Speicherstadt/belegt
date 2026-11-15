import { type SQL, sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { LESBAR } from "../inhalt/inhalt.ts";

/*
 * Der Text, gegen den Zuordnungsregeln prüfen und aus dem der Klassifikator lernt: Dateiname, Kopf und Text der Mail
 * (bei einem Anhang Absender und Betreff seiner Mail) und der gelesene Inhalt. Nicht die Einordnung, Tags oder Namen
 * aus der Ordnung: Sonst lernte der Klassifikator die Antwort mit, die ein neues Dokument noch nicht hat.
 */

/** Längster Inhalt je Dokument, den Regeln und Klassifikator lesen; Paperless-ngx kürzt ähnlich (suggestion_content) */
const MAX_INHALT = 50_000;

/** SQL für den Text eines Dokuments d */
export const merkmalText: SQL = sql`concat_ws(E'\\n', d.dateiname, m.von, m.betreff, m.text, pm.von, pm.betreff,
                                         left(i.text, ${MAX_INHALT}))`;

/** Joins für merkmalText */
export const merkmalJoins: SQL = sql`
  left join mails m on m.dokument_id = d.id
  left join lateral (select x.von, x.betreff from mail_anhaenge a join mails x on x.dokument_id = a.mail_dokument_id
                      where a.anhang_dokument_id = d.id limit 1) pm on true
  left join inhalte i on i.dokument_id = d.id`;

/** Der Text eines Dokuments; null, wenn es das Dokument nicht gibt */
export async function textFuer(db: Datenbank, dokumentId: string): Promise<string | null> {
  const [z] = await db.execute<{ text: string }>(
    sql`select ${merkmalText} as text from dokumente d ${merkmalJoins} where d.id = ${dokumentId}`,
  );
  return z ? z.text : null;
}

const BILDER = ["image/jpeg", "image/png", "image/webp"];
const liste = (werte: string[]) =>
  sql`array[${sql.join(
    werte.map((w) => sql`${w}`),
    sql`, `,
  )}]::text[]`;

/**
 * SQL-Bedingung: Der Text eines Dokuments d ist gelesen, oder es gibt keinen, den der Worker liest (wie bei den
 * Workflows). Bilder warten nur mit Texterkennung.
 */
export const textBereit = (ocr: boolean): SQL =>
  sql`(not (d.mime_type = any(${liste(LESBAR)}) or (${ocr} and d.mime_type = any(${liste(BILDER)})))
       or exists (select 1 from inhalte ib where ib.dokument_id = d.id))`;
