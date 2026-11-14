import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { betragAusText, FARBNAMEN, type Farbe, FELDTYPEN, type Feldtyp, GRENZE } from "../../shared/ordnung.ts";
import { mitAkteur, type Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumentDokumenttypen, dokumentTags, dokumenttypen, felder, feldwerte, tags } from "../db/schema.ts";
import { ARTEN } from "../einordnung/einordnung.ts";

/*
 * Tags, Dokumenttypen und eigene Felder anlegen, ändern und löschen. Löschen entfernt erst die Zuordnungen, Zeile für
 * Zeile, damit jede im Audit-Log steht, dann die Definition. Die Zuordnung zu Dokumenten steht in zuordnung.ts.
 */

const Name = z.string().trim().min(1).max(100);

export const TagEingabe = z.object({ name: Name, farbe: z.enum(FARBNAMEN as [Farbe, ...Farbe[]]).default("grau") });
export const TagAenderung = z
  .object({ name: Name.optional(), farbe: z.enum(FARBNAMEN as [Farbe, ...Farbe[]]).optional() })
  .refine((t) => t.name !== undefined || t.farbe !== undefined, { message: "Name oder Farbe" });

export const DokumenttypEingabe = z.object({ name: Name, vorgabeArt: z.enum(ARTEN).nullable().default(null) });
export const DokumenttypAenderung = z
  .object({ name: Name.optional(), vorgabeArt: z.enum(ARTEN).nullable().optional() })
  .refine((t) => t.name !== undefined || t.vorgabeArt !== undefined, { message: "Name oder Vorgabe-Art" });

const Optionen = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, { message: "Optionen doppelt" });

export const FeldEingabe = z
  .object({ name: Name, typ: z.enum(FELDTYPEN), optionen: Optionen.default([]) })
  .refine((f) => (f.typ === "auswahl") === f.optionen.length > 0, {
    message: "Optionen gibt es genau bei auswahl, dort mindestens eine",
  });
export const FeldAenderung = z
  .object({ name: Name.optional(), optionen: Optionen.min(1).optional() })
  .refine((f) => f.name !== undefined || f.optionen !== undefined, { message: "Name oder Optionen" });

export type Tag = typeof tags.$inferSelect;
export type Dokumenttyp = typeof dokumenttypen.$inferSelect;
export type Feld = Omit<typeof felder.$inferSelect, "typ"> & { typ: Feldtyp };

/** Fehler, den die Oberfläche verständlich zeigen kann (409); keine Klasse, nur ein Error mit Kennung */
export const konflikt = (meldung: string) => Object.assign(new Error(meldung), { konflikt: true as const });
export const istKonflikt = (err: unknown): err is Error & { konflikt: true } =>
  err instanceof Error && "konflikt" in err;

/** Doppelter Name (eindeutiger Index ohne Groß- und Kleinschreibung) als verständlicher Konflikt */
async function eindeutig<T>(arbeit: Promise<T>): Promise<T> {
  try {
    return await arbeit;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23505") throw konflikt("Den Namen gibt es schon");
    throw err;
  }
}

export async function tagsListen(db: Datenbank): Promise<(Tag & { anzahl: number })[]> {
  const zeilen = await db
    .select({ tag: tags, anzahl: sql<string>`(select count(*) from dokument_tags dt where dt.tag_id = ${tags.id})` })
    .from(tags)
    .orderBy(asc(sql`lower(${tags.name})`));
  return zeilen.map((z) => ({ ...z.tag, anzahl: Number(z.anzahl) }));
}

export async function tagAnlegen(db: Datenbank, eingabe: z.infer<typeof TagEingabe>, akteur: string): Promise<Tag> {
  const [neu] = await eindeutig(mitAkteur(db, akteur, (tx) => tx.insert(tags).values(eingabe).returning()));
  return neu!;
}

export async function tagAendern(
  db: Datenbank,
  id: string,
  eingabe: z.infer<typeof TagAenderung>,
  akteur: string,
): Promise<Tag | null> {
  const [t] = await eindeutig(
    mitAkteur(db, akteur, (tx) => tx.update(tags).set(eingabe).where(eq(tags.id, id)).returning()),
  );
  return t ?? null;
}

/** Löscht einen Tag: erst seine Zuordnungen (jede im Audit-Log), dann den Tag; die Dokumente bleiben unberührt */
export function tagLoeschen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    await tx.delete(dokumentTags).where(eq(dokumentTags.tagId, id));
    return (await tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id })).length > 0;
  });
}

/** Den Tag mit diesem Namen (ohne Groß- und Kleinschreibung), angelegt, falls es ihn nicht gibt; gekürzt auf 100 Zeichen */
export async function tagMitNamen(tx: Tx, name: string): Promise<Tag> {
  const sauber = Name.parse(name.trim().slice(0, 100));
  await tx.execute(sql`insert into tags (name) values (${sauber}) on conflict ((lower(name))) do nothing`);
  const [t] = await tx.select().from(tags).where(sql`lower(${tags.name}) = lower(${sauber})`);
  return t!;
}

export async function dokumenttypenListen(db: Datenbank): Promise<(Dokumenttyp & { anzahl: number })[]> {
  const zeilen = await db
    .select({
      typ: dokumenttypen,
      anzahl: sql<string>`(select count(*) from dokument_dokumenttypen dd where dd.dokumenttyp_id = ${dokumenttypen.id})`,
    })
    .from(dokumenttypen)
    .orderBy(asc(sql`lower(${dokumenttypen.name})`));
  return zeilen.map((z) => ({ ...z.typ, anzahl: Number(z.anzahl) }));
}

export async function dokumenttypAnlegen(
  db: Datenbank,
  eingabe: z.infer<typeof DokumenttypEingabe>,
  akteur: string,
): Promise<Dokumenttyp> {
  const [neu] = await eindeutig(mitAkteur(db, akteur, (tx) => tx.insert(dokumenttypen).values(eingabe).returning()));
  return neu!;
}

export async function dokumenttypAendern(
  db: Datenbank,
  id: string,
  eingabe: z.infer<typeof DokumenttypAenderung>,
  akteur: string,
): Promise<Dokumenttyp | null> {
  const [t] = await eindeutig(
    mitAkteur(db, akteur, (tx) => tx.update(dokumenttypen).set(eingabe).where(eq(dokumenttypen.id, id)).returning()),
  );
  return t ?? null;
}

export function dokumenttypLoeschen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    await tx.delete(dokumentDokumenttypen).where(eq(dokumentDokumenttypen.dokumenttypId, id));
    return (
      (await tx.delete(dokumenttypen).where(eq(dokumenttypen.id, id)).returning({ id: dokumenttypen.id })).length > 0
    );
  });
}

export async function felderListen(db: Datenbank | Tx): Promise<Feld[]> {
  return (await db
    .select()
    .from(felder)
    .orderBy(asc(sql`lower(${felder.name})`))) as Feld[];
}

export async function feldAnlegen(db: Datenbank, eingabe: z.infer<typeof FeldEingabe>, akteur: string): Promise<Feld> {
  const [neu] = await eindeutig(mitAkteur(db, akteur, (tx) => tx.insert(felder).values(eingabe).returning()));
  return neu as Feld;
}

/** Ändert Name oder Optionen; eine Option, die ein Dokument noch nutzt, lässt sich nicht entfernen */
export async function feldAendern(
  db: Datenbank,
  id: string,
  eingabe: z.infer<typeof FeldAenderung>,
  akteur: string,
): Promise<Feld | null> {
  return eindeutig(
    mitAkteur(db, akteur, async (tx) => {
      const [feld] = await tx.select().from(felder).where(eq(felder.id, id)).for("update");
      if (!feld) return null;
      if (eingabe.optionen) {
        if (feld.typ !== "auswahl") throw konflikt("Optionen gibt es nur bei einem Auswahlfeld");
        const genutzt = await tx
          .selectDistinct({ wert: feldwerte.wertText })
          .from(feldwerte)
          .where(eq(feldwerte.feldId, id));
        const fehlt = genutzt.map((g) => g.wert).filter((w) => w !== null && !eingabe.optionen!.includes(w));
        if (fehlt.length) throw konflikt(`Noch genutzt: ${fehlt.join(", ")}`);
      }
      const [neu] = await tx.update(felder).set(eingabe).where(eq(felder.id, id)).returning();
      return neu as Feld;
    }),
  );
}

export function feldLoeschen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    await tx.delete(feldwerte).where(eq(feldwerte.feldId, id));
    return (await tx.delete(felder).where(eq(felder.id, id)).returning({ id: felder.id })).length > 0;
  });
}

/** Spalten eines Feldwerts in feldwerte; genau eine ist gesetzt */
export interface Spalten {
  wertText: string | null;
  wertZahl: number | null;
  wertDatum: string | null;
  wertBool: boolean | null;
}

const leer: Spalten = { wertText: null, wertZahl: null, wertDatum: null, wertBool: null };

const Ganzzahl = z.number().int().min(-GRENZE).max(GRENZE);
const echtesDatum = (t: string) => {
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
};
export const Datum = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(echtesDatum, { message: "Kein gültiger Tag" });

/** Betrag als ganze Cent oder als Text in deutscher Schreibweise („1.234,56“) */
export const Betrag = z.union([
  Ganzzahl,
  z.string().transform((t, ctx) => {
    const cent = betragAusText(t);
    if (cent === null) {
      ctx.addIssue({ code: "custom", message: "Kein Betrag, erwartet etwa 1.234,56" });
      return z.NEVER;
    }
    return cent;
  }),
]);

/** Prüft einen Wert gegen den Typ seines Feldes (Zod) und gibt die Spalten zurück, in die er gehört */
export function feldwertSpalten(feld: Pick<Feld, "typ" | "optionen">, wert: unknown): Spalten {
  switch (feld.typ) {
    case "text":
      return { ...leer, wertText: z.string().trim().min(1).max(1000).parse(wert) };
    case "auswahl":
      return { ...leer, wertText: z.enum(feld.optionen as [string, ...string[]]).parse(wert) };
    case "link":
      return {
        ...leer,
        // Nur http und https: ein javascript:-Link wäre beim Klick ein Skript
        wertText: z
          .url({ protocol: /^https?$/ })
          .max(2000)
          .parse(typeof wert === "string" ? wert.trim() : wert),
      };
    case "zahl":
      return { ...leer, wertZahl: Ganzzahl.parse(wert) };
    case "betrag":
      return { ...leer, wertZahl: Betrag.parse(wert) };
    case "datum":
      return { ...leer, wertDatum: Datum.parse(wert) };
    case "ja_nein":
      return { ...leer, wertBool: z.boolean().parse(wert) };
  }
}

/** Der Wert aus den Spalten, wie ihn die Schnittstelle liefert */
export function feldwertAus(s: Spalten): string | number | boolean | null {
  return s.wertText ?? s.wertZahl ?? s.wertDatum ?? s.wertBool;
}
