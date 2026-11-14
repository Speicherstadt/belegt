import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type Aufbewahrungsart, fristende } from "../../shared/fristen.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { einordnungen, sperren } from "../db/schema.ts";

export const ARTEN = [
  "buecher",
  "zoll",
  "beleg",
  "geschaeftsbrief",
  "sonstige",
  "freiwillig",
  "frei",
] as const satisfies readonly Aufbewahrungsart[];
const GESETZLICH: Aufbewahrungsart[] = ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige"];

const Datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EinordnungEingabe = z.object({
  art: z.enum(ARTEN),
  entstanden: Datum,
  freiwilligBis: Datum.optional(),
  titel: z.string().trim().max(300).optional(),
  korrespondent: z.string().trim().max(300).optional(),
});
export type EinordnungEingabe = z.infer<typeof EinordnungEingabe>;

export type Einordnung = typeof einordnungen.$inferSelect;

/**
 * Ordnet ein Dokument ein: Die Frist rechnet shared/fristen.ts (§ 147 AO), gespeichert wird sie mit, damit sie
 * versiegelt ist und sich abfragen lässt. Eine neue Einordnung ersetzt die alte nicht, sie kommt dazu.
 */
export async function einordnen(
  db: Datenbank,
  dokumentId: string,
  eingabe: EinordnungEingabe,
  akteur: string,
): Promise<Einordnung> {
  const frist = fristende(eingabe.art, eingabe.entstanden, { freiwilligBis: eingabe.freiwilligBis });
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(einordnungen)
      .values({
        dokumentId,
        art: eingabe.art,
        entstanden: eingabe.entstanden,
        fristBis: frist.bis,
        titel: eingabe.titel || null,
        korrespondent: eingabe.korrespondent || null,
      })
      .returning(),
  );
  return neu!;
}

export async function aktuelle(db: Datenbank, dokumentId: string): Promise<Einordnung | null> {
  const [e] = await db
    .select()
    .from(einordnungen)
    .where(eq(einordnungen.dokumentId, dokumentId))
    .orderBy(desc(einordnungen.erstelltAm), desc(einordnungen.id))
    .limit(1);
  return e ?? null;
}

export const Gruppe = z.enum(["alle", "offen", "pflicht", "freiwillig", "frei", "loeschbar", "geloescht"]);
export type Gruppe = z.infer<typeof Gruppe>;

const geloescht = sql`exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)`;
const gesperrt = sql`exists (select 1 from sperren s where s.aufgehoben_am is null and e.entstanden between s.von and s.bis)`;

/**
 * SQL-Bedingung für eine Gruppe; d ist die Zeile aus dokumente, e ihre neueste Einordnung (oder NULL). Gelöschte
 * Dokumente zeigt nur die Gruppe „geloescht“.
 */
export function gruppenBedingung(gruppe: Gruppe, heute: string) {
  if (gruppe === "geloescht") return geloescht;
  return sql`not ${geloescht} and ${gruppenOhneGeloescht(gruppe, heute)}`;
}

function gruppenOhneGeloescht(gruppe: Exclude<Gruppe, "geloescht">, heute: string) {
  switch (gruppe) {
    case "loeschbar":
      return sql`e.id is not null and (e.art = 'frei' or e.frist_bis < ${heute}::date) and not ${gesperrt}`;
    case "alle":
      return sql`true`;
    case "offen":
      return sql`e.id is null`;
    case "pflicht":
      return sql`e.art in (${sql.join(
        GESETZLICH.map((a) => sql`${a}`),
        sql`, `,
      )})`;
    case "freiwillig":
      return sql`e.art = 'freiwillig'`;
    case "frei":
      return sql`e.art = 'frei'`;
  }
}

export type Sperre = typeof sperren.$inferSelect;

export const SperreEingabe = z
  .object({ grund: z.string().trim().min(1).max(500), von: Datum, bis: Datum })
  .refine((s) => s.von <= s.bis, {
    message: "„von“ liegt nach „bis“",
  });

export async function sperreAnlegen(
  db: Datenbank,
  eingabe: z.infer<typeof SperreEingabe>,
  akteur: string,
): Promise<Sperre> {
  const [neu] = await mitAkteur(db, akteur, (tx) => tx.insert(sperren).values(eingabe).returning());
  return neu!;
}

export async function sperreAufheben(db: Datenbank, id: string, akteur: string): Promise<Sperre | null> {
  const [s] = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(sperren)
      .set({ aufgehobenAm: new Date() })
      .where(and(eq(sperren.id, id), isNull(sperren.aufgehobenAm)))
      .returning(),
  );
  return s ?? null;
}

export function sperrenListen(db: Datenbank): Promise<Sperre[]> {
  return db.select().from(sperren).orderBy(desc(sperren.angelegtAm));
}

export interface Uebersicht {
  gesamt: number;
  offen: number;
  jeArt: Record<string, number>;
  gesperrt: number;
  loeschbar: number;
}

/**
 * Zahlen für die Seite Fristen. Gesperrt: entstanden im Zeitraum einer offenen Sperre. Löschbar: Frist abgelaufen
 * (oder frei) und nicht gesperrt; gelöscht wird trotzdem nur nach Bestätigung (§ 147 Abs. 3 Satz 5 AO).
 */
export async function uebersicht(db: Datenbank, heute: string): Promise<Uebersicht> {
  const zeilen = await db.execute<{ art: string | null; anzahl: string; gesperrt: string; loeschbar: string }>(sql`
    with aktuell as (
      select d.id, e.art, e.entstanden, e.frist_bis,
             exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null) as geloescht,
             exists (select 1 from sperren s where s.aufgehoben_am is null and e.entstanden between s.von and s.bis) as gesperrt
        from dokumente d
        left join lateral (select * from einordnungen x where x.dokument_id = d.id order by x.erstellt_am desc, x.id desc limit 1) e on true
    )
    select art, count(*) as anzahl,
           count(*) filter (where gesperrt) as gesperrt,
           count(*) filter (where art is not null and not gesperrt and (frist_bis is null or frist_bis < ${heute}::date)) as loeschbar
      from aktuell where not geloescht group by art`);
  const jeArt: Record<string, number> = {};
  let gesamt = 0;
  let offen = 0;
  let gesperrt = 0;
  let loeschbar = 0;
  for (const z of zeilen) {
    const n = Number(z.anzahl);
    gesamt += n;
    gesperrt += Number(z.gesperrt);
    loeschbar += Number(z.loeschbar);
    if (z.art === null) offen = n;
    else jeArt[z.art] = n;
  }
  return { gesamt, offen, jeArt, gesperrt, loeschbar };
}
