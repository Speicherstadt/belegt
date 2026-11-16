import { desc, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { kettenpruefungen } from "../db/schema.ts";
import { type Befund, pruefen } from "../dokumente/dokumente.ts";

/*
 * Prüfung von Hash-Kette, Kopf und Siegeln als gespeicherter Lauf (docs/pruefung.md#taegliche-pruefung): Der Worker
 * prüft einmal am Tag, der Inhaber auf Wunsch; Startseite und Benachrichtigung lesen den letzten Lauf. Die Prüfung
 * selbst liest das ganze Audit-Log und wird mit ihm langsamer, deshalb nicht bei jedem Aufruf der Startseite.
 */

export interface Kettenpruefung {
  geprueftAm: string;
  ok: boolean;
  befunde: number;
  befundListe: Befund[];
  eintraege: number;
  dauerMs: number;
  ausgeloestVon: string;
}

/** Abstand der Läufe im Worker */
export const PRUEF_ABSTAND_STUNDEN = 24;

const ausZeile = (z: typeof kettenpruefungen.$inferSelect): Kettenpruefung => ({
  geprueftAm: z.geprueftAm.toISOString(),
  ok: z.ok,
  befunde: z.befunde,
  befundListe: z.befundListe as Befund[],
  eintraege: z.eintraege,
  dauerMs: z.dauerMs,
  ausgeloestVon: z.ausgeloestVon,
});

/** Prüft jetzt und speichert das Ergebnis; akteur steht im Lauf und im Audit-Log */
export async function kettePruefen(db: Datenbank, akteur: string): Promise<Kettenpruefung> {
  const beginn = performance.now();
  const [befundListe, [zahl]] = await Promise.all([
    pruefen(db),
    db.execute<{ eintraege: string }>(sql`select count(*) as eintraege from audit_log`),
  ]);
  const [zeile] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(kettenpruefungen)
      .values({
        ok: befundListe.length === 0,
        befunde: befundListe.length,
        befundListe,
        eintraege: Number(zahl?.eintraege ?? 0),
        dauerMs: Math.round(performance.now() - beginn),
        ausgeloestVon: akteur,
      })
      .returning(),
  );
  return ausZeile(zeile!);
}

/** Der neueste Lauf, null vor dem ersten */
export async function letztePruefung(db: Datenbank): Promise<Kettenpruefung | null> {
  const [zeile] = await db.select().from(kettenpruefungen).orderBy(desc(kettenpruefungen.id)).limit(1);
  return zeile ? ausZeile(zeile) : null;
}

/** Ob der Worker wieder prüfen soll: noch nie, oder der letzte Lauf ist älter als der Abstand */
export function pruefungFaellig(letzte: Kettenpruefung | null, jetzt: Date): boolean {
  return !letzte || jetzt.getTime() - new Date(letzte.geprueftAm).getTime() >= PRUEF_ABSTAND_STUNDEN * 3_600_000;
}
