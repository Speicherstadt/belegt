import { angabenZumBetrieb, LEERE_ANGABEN } from "@firsttris/gobd-kern/verfahrensdoku";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { einstellungen } from "../db/schema.ts";

/**
 * Angaben zum Betrieb: alle Felder aus dem Schema des GoBD-Kerns (Beschriftung, Höchstlänge, Lücke je Feld), dazu
 * „aufsicht“, das die Frist für Buchungsbelege verlängert (Art. 97 § 19a Abs. 3 EGAO). Name und Anschrift stehen auch
 * in der index.xml des Z3-Exports.
 */
export const EinstellungenEingabe = angabenZumBetrieb.extend({ aufsicht: z.boolean() });
export type EinstellungenEingabe = z.infer<typeof EinstellungenEingabe>;
export type Einstellungen = typeof einstellungen.$inferSelect;

export async function laden(db: Datenbank): Promise<Einstellungen> {
  const [e] = await db.select().from(einstellungen).where(eq(einstellungen.id, 1));
  // Die Migration legt die Zeile an; fehlt sie trotzdem, gelten die Vorgaben
  return e ?? { id: 1, ...LEERE_ANGABEN, aufsicht: false, geaendertAm: new Date(0) };
}

export async function speichern(db: Datenbank, eingabe: EinstellungenEingabe, akteur: string): Promise<Einstellungen> {
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(einstellungen)
      .values({ id: 1, ...eingabe })
      .onConflictDoUpdate({ target: einstellungen.id, set: { ...eingabe, geaendertAm: sql`now()` } })
      .returning(),
  );
  return neu!;
}
