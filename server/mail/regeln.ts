import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Regel, type Vorschlag, vorschlagen } from "../../shared/regeln.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { regeln } from "../db/schema.ts";
import { laden } from "../dokumente/dokumente.ts";
import { ARTEN } from "../einordnung/einordnung.ts";
import { mailZuDokument } from "./import.ts";

const Bedingung = z
  .object({
    absender: z.string().trim().min(1).max(320).optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    betreffEnthaelt: z.string().trim().min(1).max(200).optional(),
    anhangTyp: z.string().trim().min(1).max(100).optional(),
  })
  .refine((b) => Object.values(b).some(Boolean), { message: "Mindestens eine Bedingung" });

export const RegelEingabe = z.object({
  name: z.string().trim().min(1).max(200),
  wenn: Bedingung,
  dann: z.enum(ARTEN),
  reihenfolge: z.number().int().min(0).max(10_000).default(0),
});

export async function listen(db: Datenbank) {
  return db.select().from(regeln).orderBy(asc(regeln.reihenfolge), asc(regeln.erstelltAm));
}

export async function anlegen(db: Datenbank, eingabe: z.infer<typeof RegelEingabe>, akteur: string) {
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(regeln)
      .values({ name: eingabe.name, bedingung: eingabe.wenn, art: eingabe.dann, reihenfolge: eingabe.reihenfolge })
      .returning(),
  );
  return neu!;
}

export async function aktivSetzen(db: Datenbank, id: string, aktiv: boolean, akteur: string) {
  const [r] = await mitAkteur(db, akteur, (tx) =>
    tx.update(regeln).set({ aktiv }).where(eq(regeln.id, id)).returning(),
  );
  return r ?? null;
}

/** Vorschlag für ein Dokument: Merkmale aus seiner Mail (bei einem Anhang aus der Mail, aus der er stammt) */
export async function vorschlag(db: Datenbank, dokumentId: string): Promise<Vorschlag | null> {
  const dokument = await laden(db, dokumentId);
  if (!dokument) return null;
  const mail = await mailZuDokument(db, dokumentId);
  const aktive: Regel[] = (await listen(db))
    .filter((r) => r.aktiv)
    .map((r) => ({ id: r.id, name: r.name, wenn: r.bedingung as Regel["wenn"], dann: r.art as Regel["dann"] }));
  return vorschlagen(aktive, {
    absender: mail?.von ?? null,
    betreff: mail?.betreff ?? dokument.dateiname ?? "",
    anhangTypen: mail ? mail.anhaenge.map((a) => a.mimeType) : [dokument.mimeType],
  });
}
