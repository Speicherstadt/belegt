import { sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import type { Zeitraum } from "./einladungen.ts";

/**
 * Prüferzugang (Z1, GoBD Rz. 165): nur lesen, nur Dokumente des freigegebenen Zeitraums, nur Archiv und Prüfung.
 * Ein Dokument gehört zum Zeitraum nach belegt_dokument_tag (Entstehung, sonst Eingang), wie beim Z3-Export.
 */

const ERLAUBT = [
  /^\/api\/ich$/,
  /^\/api\/dokumente$/,
  /^\/api\/dokumente\/[^/]+(\/(datei|inhalt|mail|verlauf))?$/,
  /^\/api\/export$/,
  /^\/api\/pruefung$/,
  /^\/api\/zeitstempel(\/[^/]+\/token)?$/,
];

export const prueferDarf = (methode: string, pfad: string): boolean =>
  (methode === "GET" || methode === "HEAD") && ERLAUBT.some((r) => r.test(pfad));

/** Die Dokument-ID eines Pfads unter /api/dokumente/:id, sonst null */
export const dokumentImPfad = (pfad: string): string | null => /^\/api\/dokumente\/([^/]+)/.exec(pfad)?.[1] ?? null;

/** Der Zeitraum aus dem Zugang; ohne beide Tage (ältere Zugänge) ein leerer, in dem nichts liegt */
export const prueferZeitraum = (von: unknown, bis: unknown): Zeitraum =>
  typeof von === "string" && typeof bis === "string" && von <= bis
    ? { von, bis }
    : { von: "9999-12-31", bis: "0001-01-01" };

/** Welche der Dokumente im Zeitraum liegen */
export async function imZeitraum(db: Datenbank, ids: string[], z: Zeitraum): Promise<Set<string>> {
  const gueltig = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!gueltig.length) return new Set();
  const zeilen = await db.execute<{ id: string }>(sql`
    select d.id from dokumente d
     where d.id = any(array[${sql.join(
       gueltig.map((id) => sql`${id}`),
       sql`, `,
     )}]::uuid[])
       and belegt_dokument_tag(d.id) between ${z.von}::date and ${z.bis}::date`);
  return new Set([...zeilen].map((z) => z.id));
}

/** Schnittmenge zweier Zeiträume oder null, wenn sie sich nicht überschneiden */
export function schnitt(a: Zeitraum, b: Zeitraum): Zeitraum | null {
  // Tage als JJJJ-MM-TT lassen sich als Text sortieren
  const von = [a.von, b.von].sort()[1]!;
  const bis = [a.bis, b.bis].sort()[0]!;
  return von <= bis ? { von, bis } : null;
}
