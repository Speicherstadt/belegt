import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { einstellungen } from "../db/schema.ts";

const Text = (max: number) => z.string().trim().max(max);

export const EinstellungenEingabe = z.object({
  firma: Text(300),
  anschrift: Text(1000),
  verantwortlich: Text(300),
  aufsicht: z.boolean(),
  datensicherung: Text(5000),
  scannen: Text(5000),
  ergaenzungen: Text(20000),
});
export type EinstellungenEingabe = z.infer<typeof EinstellungenEingabe>;
export type Einstellungen = typeof einstellungen.$inferSelect;

export async function laden(db: Datenbank): Promise<Einstellungen> {
  const [e] = await db.select().from(einstellungen).where(eq(einstellungen.id, 1));
  // Die Migration legt die Zeile an; fehlt sie trotzdem, gelten die Vorgaben
  return (
    e ?? {
      id: 1,
      firma: "",
      anschrift: "",
      verantwortlich: "",
      aufsicht: false,
      datensicherung: "",
      scannen: "",
      ergaenzungen: "",
      geaendertAm: new Date(0),
    }
  );
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
