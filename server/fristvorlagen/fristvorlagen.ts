import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { fristvorlagen } from "../db/schema.ts";

/*
 * Eigene Fristvorlagen (docs/fristen.md#eigene-vorlagen): Name und Dauer in Monaten, etwa „Garantie, 24 Monate“. Sie
 * helfen nur beim Einordnen als „freiwillig mit Frist“; die gesetzlichen Fristen der übrigen Arten bleiben, wie sie sind.
 * Jede Änderung steht im Audit-Log.
 */

export const VorlageEingabe = z.object({
  name: z.string().trim().min(1).max(100),
  monate: z.number().int().min(1).max(1200),
});

export interface Fristvorlage {
  id: string;
  name: string;
  monate: number;
}

const spalten = { id: fristvorlagen.id, name: fristvorlagen.name, monate: fristvorlagen.monate };

export const vorlagenListen = (db: Datenbank): Promise<Fristvorlage[]> =>
  db
    .select(spalten)
    .from(fristvorlagen)
    .orderBy(asc(sql`lower(${fristvorlagen.name})`));

export async function vorlageAnlegen(
  db: Datenbank,
  eingabe: z.infer<typeof VorlageEingabe>,
  akteur: string,
): Promise<Fristvorlage> {
  const [neu] = await mitAkteur(db, akteur, (tx) => tx.insert(fristvorlagen).values(eingabe).returning(spalten));
  return neu!;
}

/** Löscht eine Vorlage; false, wenn es sie nicht gibt. Schon eingeordnete Dokumente behalten ihr Fristende */
export async function vorlageLoeschen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  const weg = await mitAkteur(db, akteur, (tx) =>
    tx.delete(fristvorlagen).where(eq(fristvorlagen.id, id)).returning({ id: fristvorlagen.id }),
  );
  return weg.length > 0;
}
