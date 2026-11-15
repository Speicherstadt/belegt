import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Regel, type Vorschlag, vorschlagen } from "../../shared/regeln.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { regeln } from "../db/schema.ts";
import { laden } from "../dokumente/dokumente.ts";
import { ARTEN } from "../einordnung/einordnung.ts";
import {
  type AufgeloesterVorschlag,
  OrdnungsVorschlag,
  vorschlagAufloesen,
  vorschlagPruefen,
} from "../ordnung/vorschlag.ts";
import { mailZuDokument } from "./import.ts";

const Bedingung = z
  .object({
    absender: z.string().trim().min(1).max(320).optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    betreffEnthaelt: z.string().trim().min(1).max(200).optional(),
    anhangTyp: z.string().trim().min(1).max(100).optional(),
  })
  .refine((b) => Object.values(b).some(Boolean), { message: "Mindestens eine Bedingung" });

export const RegelEingabe = z
  .object({
    name: z.string().trim().min(1).max(200),
    wenn: Bedingung,
    /** null: die Regel schlägt nur Tags, Dokumenttyp oder Feldwerte vor, die Einordnung bleibt offen */
    dann: z.enum(ARTEN).nullable().default(null),
    reihenfolge: z.number().int().min(0).max(10_000).default(0),
    /** Zusätzlich vorgeschlagen: Tags, Dokumenttyp und Feldwerte */
    ordnung: OrdnungsVorschlag.optional(),
  })
  .refine((r) => r.dann !== null || !ordnungLeer(r.ordnung), {
    message: "Eine Regel ohne Art schlägt mindestens einen Tag, einen Dokumenttyp oder einen Feldwert vor",
  });

const ordnungLeer = (o: OrdnungsVorschlag | null | undefined) =>
  !o || (!o.tags.length && !o.dokumenttyp && !o.felder.length);

export async function listen(db: Datenbank) {
  return db.select().from(regeln).orderBy(asc(regeln.reihenfolge), asc(regeln.erstelltAm));
}

/** Legt eine Regel an; Tags, Dokumenttyp und Felder im Vorschlag muss es geben, Werte passen zu ihrem Feld */
export async function anlegen(db: Datenbank, eingabe: z.infer<typeof RegelEingabe>, akteur: string) {
  const ordnung = eingabe.ordnung ? await vorschlagPruefen(db, eingabe.ordnung) : null;
  const leer = ordnungLeer(ordnung);
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(regeln)
      .values({
        name: eingabe.name,
        bedingung: eingabe.wenn,
        art: eingabe.dann,
        reihenfolge: eingabe.reihenfolge,
        ordnung: leer ? null : ordnung,
      })
      .returning(),
  );
  return neu!;
}

/** Regeln mit aufgelöstem Vorschlag für Tags, Dokumenttyp und Felder (Namen statt IDs) */
export async function listenMitOrdnung(db: Datenbank) {
  const alle = await listen(db);
  return Promise.all(alle.map(async (r) => ({ ...r, ordnung: await vorschlagAufloesen(db, r.ordnung) })));
}

export async function aktivSetzen(db: Datenbank, id: string, aktiv: boolean, akteur: string) {
  const [r] = await mitAkteur(db, akteur, (tx) =>
    tx.update(regeln).set({ aktiv }).where(eq(regeln.id, id)).returning(),
  );
  return r ?? null;
}

/**
 * Vorschlag für ein Dokument: Merkmale aus seiner Mail (bei einem Anhang aus der Mail, aus der er stammt); dazu, was
 * die Regel an Tags, Dokumenttyp und Feldwerten vorschlägt
 */
export async function vorschlag(
  db: Datenbank,
  dokumentId: string,
): Promise<(Vorschlag & { ordnung: AufgeloesterVorschlag | null }) | null> {
  const dokument = await laden(db, dokumentId);
  if (!dokument) return null;
  const mail = await mailZuDokument(db, dokumentId);
  const zeilen = (await listen(db)).filter((r) => r.aktiv);
  const aktive: Regel[] = zeilen.map((r) => ({
    id: r.id,
    name: r.name,
    wenn: r.bedingung as Regel["wenn"],
    dann: r.art as Regel["dann"],
  }));
  const v = vorschlagen(aktive, {
    absender: mail?.von ?? null,
    betreff: mail?.betreff ?? dokument.dateiname ?? "",
    anhangTypen: mail ? mail.anhaenge.map((a) => a.mimeType) : [dokument.mimeType],
  });
  if (!v) return null;
  const ordnung = await vorschlagAufloesen(db, zeilen.find((r) => r.id === v.regel.id)?.ordnung);
  // Eine Regel ohne Art, deren Tags, Typ und Felder inzwischen gelöscht sind, hat nichts mehr vorzuschlagen
  return v.art === null && !ordnung ? null : { ...v, ordnung };
}
