import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { benachrichtigungEinstellungen } from "../db/schema.ts";

/*
 * Einstellungen der Benachrichtigungen (docs/betrieb.md#benachrichtigungen): je Anlass an oder aus, dazu die Schwelle.
 * Fehlt ein Anlass in der gespeicherten Zeile (älterer Stand), gilt seine Vorgabe.
 */

const an = (vorgabe: boolean) => z.boolean().default(vorgabe);
const tage = (vorgabe: number) => z.number().int().min(1).max(60).default(vorgabe);

export const Anlaesse = z.object({
  /** Backup oder Test-Restore fehlgeschlagen, oder seit `tage` Tagen kein erfolgreiches Backup */
  backup: z.object({ an: an(true), tage: tage(2) }).default({ an: true, tage: 2 }),
  /** Postfach seit `tage` Tagen nicht erfolgreich abgerufen, oder eine Aktion im Postfach fehlgeschlagen */
  postfach: z.object({ an: an(true), tage: tage(1) }).default({ an: true, tage: 1 }),
  /** Die tägliche Prüfung der Kette meldet Befunde */
  kette: z.object({ an: an(true) }).default({ an: true }),
  /** Ein Löschantrag wartet auf die zweite Person (an die, die bestätigen dürfen) */
  loeschung: z.object({ an: an(true) }).default({ an: true }),
  /** Wöchentlich: Fristen, die in den nächsten 30 Tagen enden */
  fristen: z.object({ an: an(true) }).default({ an: true }),
  /** Mehr als `anzahl` Dokumente im Eingang */
  eingang: z
    .object({ an: an(false), anzahl: z.number().int().min(1).max(100_000).default(50) })
    .default({ an: false, anzahl: 50 }),
  /** Workflows sind fehlgeschlagen */
  workflow: z.object({ an: an(true) }).default({ an: true }),
});
export type Anlaesse = z.infer<typeof Anlaesse>;
export type Anlass = keyof Anlaesse;
export const ANLAESSE = Object.keys(Anlaesse.shape) as Anlass[];

export const EinstellungenEingabe = z.object({
  anlaesse: Anlaesse,
  anInhaber: z.boolean(),
  weitereEmpfaenger: z.array(z.email().max(254)).max(20),
});
export type Einstellungen = z.infer<typeof EinstellungenEingabe>;

export async function laden(db: Datenbank): Promise<Einstellungen> {
  const [e] = await db.select().from(benachrichtigungEinstellungen).where(eq(benachrichtigungEinstellungen.id, 1));
  const anlaesse = Anlaesse.safeParse(e?.anlaesse ?? {});
  return {
    anlaesse: anlaesse.success ? anlaesse.data : Anlaesse.parse({}),
    anInhaber: e?.anInhaber ?? true,
    weitereEmpfaenger: e?.weitereEmpfaenger ?? [],
  };
}

export async function speichern(db: Datenbank, eingabe: Einstellungen, akteur: string): Promise<Einstellungen> {
  const werte = { ...eingabe, weitereEmpfaenger: [...new Set(eingabe.weitereEmpfaenger.map((a) => a.toLowerCase()))] };
  await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(benachrichtigungEinstellungen)
      .values({ id: 1, ...werte })
      .onConflictDoUpdate({ target: benachrichtigungEinstellungen.id, set: { ...werte, geaendertAm: sql`now()` } }),
  );
  return laden(db);
}
