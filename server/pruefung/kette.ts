import { desc, sql } from "drizzle-orm";
import { mitAkteur, type Tx } from "../db/akteur.ts";
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

/** Name der Sperre in Postgres, die ein Lauf bis zum Ende seiner Transaktion hält */
export const KETTE_SPERRE = "belegt_kettenpruefung";

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

/**
 * Prüft jetzt und speichert das Ergebnis; akteur steht im Lauf und im Audit-Log. Es läuft höchstens eine Prüfung
 * zugleich, über alle Prozesse (Sperre in Postgres bis zum Ende der Transaktion): Läuft schon eine, kommt null zurück,
 * statt die ganze Kette ein weiteres Mal zu lesen. Mit faelligAm prüft sie nur, wenn der letzte Lauf zu diesem
 * Zeitpunkt fällig ist; so prüfen zwei Worker nicht kurz nacheinander dasselbe.
 */
export async function kettePruefen(
  db: Datenbank,
  akteur: string,
  { faelligAm }: { faelligAm?: Date } = {},
): Promise<Kettenpruefung | null> {
  return mitAkteur(db, akteur, async (tx) => {
    const [sperre] = await tx.execute<{ frei: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${KETTE_SPERRE}, 0)) as frei`,
    );
    if (!sperre?.frei) return null;
    if (faelligAm && !pruefungFaellig(await letztePruefung(tx), faelligAm)) return null;
    const beginn = performance.now();
    const befundListe = await pruefen(tx);
    const [zahl] = await tx.execute<{ eintraege: string }>(sql`select count(*) as eintraege from audit_log`);
    const [zeile] = await tx
      .insert(kettenpruefungen)
      .values({
        ok: befundListe.length === 0,
        befunde: befundListe.length,
        befundListe,
        eintraege: Number(zahl?.eintraege ?? 0),
        dauerMs: Math.round(performance.now() - beginn),
        ausgeloestVon: akteur,
      })
      .returning();
    return ausZeile(zeile!);
  });
}

/** Der neueste Lauf, null vor dem ersten */
export async function letztePruefung(db: Datenbank | Tx): Promise<Kettenpruefung | null> {
  const [zeile] = await db.select().from(kettenpruefungen).orderBy(desc(kettenpruefungen.id)).limit(1);
  return zeile ? ausZeile(zeile) : null;
}

/** Ob der Worker wieder prüfen soll: noch nie, oder der letzte Lauf ist älter als der Abstand */
export function pruefungFaellig(letzte: Kettenpruefung | null, jetzt: Date): boolean {
  return !letzte || jetzt.getTime() - new Date(letzte.geprueftAm).getTime() >= PRUEF_ABSTAND_STUNDEN * 3_600_000;
}
