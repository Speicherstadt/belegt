import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { parameterNormalisieren } from "../../shared/archivansicht.ts";
import type { Angemeldet } from "../auth.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { gespeicherteAnsichten } from "../db/schema.ts";

/*
 * Gespeicherte Ansichten des Archivs (docs/ordnung.md#gespeicherte-ansichten): Suche und Filter unter einem Namen, je
 * Zugang. Der Inhaber kann eine Ansicht für alle freigeben; die Steuerberatung sieht sie, der Prüfer nicht, er sieht
 * nur seine eigenen (die Liste zeigt ihm ohnehin nur seinen Zeitraum). Ansichten sind Einstellungen: löschen geht,
 * jede Änderung steht im Audit-Log. Programme mit Token haben keine Ansichten.
 */

const Name = z.string().trim().min(1).max(100);
const Parameter = z
  .record(z.string().max(50), z.string().max(1000))
  .refine((p) => Object.keys(p).length <= 30, { message: "Zu viele Parameter" });

export const AnsichtEingabe = z.object({
  name: Name,
  parameter: Parameter,
  fuerAlle: z.boolean().default(false),
});

export const AnsichtAenderung = z
  .object({ name: Name.optional(), parameter: Parameter.optional(), fuerAlle: z.boolean().optional() })
  .refine((a) => a.name !== undefined || a.parameter !== undefined || a.fuerAlle !== undefined, {
    message: "Keine Änderung",
  });

export const Reihenfolge = z.object({ ids: z.array(z.uuid()).min(1).max(200) });

export interface Ansicht {
  id: string;
  name: string;
  parameter: Record<string, string>;
  fuerAlle: boolean;
  reihenfolge: number;
  /** Ob die angemeldete Person sie ändern darf (ihre eigene) */
  eigene: boolean;
}

type Zeile = typeof gespeicherteAnsichten.$inferSelect;
const alsAnsicht = (z: Zeile, nutzer: Angemeldet): Ansicht => ({
  id: z.id,
  name: z.name,
  parameter: z.parameter as Record<string, string>,
  fuerAlle: z.fuerAlle,
  reihenfolge: z.reihenfolge,
  eigene: z.besitzer === nutzer.id,
});

/** Ein Name ist je Zugang schon vergeben (eindeutiger Index ohne Groß- und Kleinschreibung) */
export const nameVergeben = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === "23505";
};

/** Was die Person sieht: ihre eigenen, und außer dem Prüfer die für alle freigegebenen */
const sichtbar = (nutzer: Angemeldet) =>
  nutzer.role === "pruefer"
    ? eq(gespeicherteAnsichten.besitzer, nutzer.id)
    : or(eq(gespeicherteAnsichten.besitzer, nutzer.id), eq(gespeicherteAnsichten.fuerAlle, true));

export async function ansichtenListen(db: Datenbank, nutzer: Angemeldet): Promise<Ansicht[]> {
  const zeilen = await db
    .select()
    .from(gespeicherteAnsichten)
    .where(sichtbar(nutzer))
    // Zuerst die für alle freigegebenen anderer, dann die eigenen, je in ihrer Reihenfolge
    .orderBy(
      sql`${gespeicherteAnsichten.besitzer} = ${nutzer.id}`,
      asc(gespeicherteAnsichten.reihenfolge),
      sql`lower(${gespeicherteAnsichten.name})`,
    );
  return zeilen.map((z) => alsAnsicht(z, nutzer));
}

/** Eine Ansicht, die die Person sieht, sonst null */
export async function ansichtLaden(db: Datenbank, nutzer: Angemeldet, id: string): Promise<Ansicht | null> {
  const [z] = await db
    .select()
    .from(gespeicherteAnsichten)
    .where(and(eq(gespeicherteAnsichten.id, id), sichtbar(nutzer)));
  return z ? alsAnsicht(z, nutzer) : null;
}

/** Legt eine Ansicht an, am Ende der eigenen Reihenfolge; die Parameter kommen in die feste Form */
export async function ansichtAnlegen(
  db: Datenbank,
  nutzer: Angemeldet,
  eingabe: z.infer<typeof AnsichtEingabe>,
  akteur: string,
): Promise<Ansicht> {
  const [neu] = await mitAkteur(db, akteur, async (tx) => {
    const [letzte] = await tx.execute<{ n: number | null }>(
      sql`select max(reihenfolge) as n from gespeicherte_ansichten where besitzer = ${nutzer.id}`,
    );
    return tx
      .insert(gespeicherteAnsichten)
      .values({
        besitzer: nutzer.id,
        name: eingabe.name,
        parameter: parameterNormalisieren(eingabe.parameter),
        fuerAlle: eingabe.fuerAlle,
        reihenfolge: (letzte?.n ?? -1) + 1,
      })
      .returning();
  });
  return alsAnsicht(neu!, nutzer);
}

/** Ändert eine eigene Ansicht; null, wenn es sie für die Person nicht als eigene gibt */
export async function ansichtAendern(
  db: Datenbank,
  nutzer: Angemeldet,
  id: string,
  a: z.infer<typeof AnsichtAenderung>,
  akteur: string,
): Promise<Ansicht | null> {
  const [z] = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(gespeicherteAnsichten)
      .set({
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.parameter !== undefined ? { parameter: parameterNormalisieren(a.parameter) } : {}),
        ...(a.fuerAlle !== undefined ? { fuerAlle: a.fuerAlle } : {}),
        geaendertAm: new Date(),
      })
      .where(and(eq(gespeicherteAnsichten.id, id), eq(gespeicherteAnsichten.besitzer, nutzer.id)))
      .returning(),
  );
  return z ? alsAnsicht(z, nutzer) : null;
}

export async function ansichtLoeschen(db: Datenbank, nutzer: Angemeldet, id: string, akteur: string) {
  const weg = await mitAkteur(db, akteur, (tx) =>
    tx
      .delete(gespeicherteAnsichten)
      .where(and(eq(gespeicherteAnsichten.id, id), eq(gespeicherteAnsichten.besitzer, nutzer.id)))
      .returning({ id: gespeicherteAnsichten.id }),
  );
  return weg.length > 0;
}

/**
 * Setzt die Reihenfolge der eigenen Ansichten nach ids; fremde oder unbekannte IDs sind ein Fehler (false), dann
 * ändert sich nichts. Nur Zeilen, deren Platz sich ändert, kommen ins Audit-Log.
 */
export async function reihenfolgeSetzen(db: Datenbank, nutzer: Angemeldet, ids: string[], akteur: string) {
  const eindeutig = [...new Set(ids)];
  return mitAkteur(db, akteur, async (tx) => {
    const eigene = await tx
      .select({ id: gespeicherteAnsichten.id, reihenfolge: gespeicherteAnsichten.reihenfolge })
      .from(gespeicherteAnsichten)
      .where(and(eq(gespeicherteAnsichten.besitzer, nutzer.id), inArray(gespeicherteAnsichten.id, eindeutig)));
    if (eigene.length !== eindeutig.length) return false;
    const bisher = new Map(eigene.map((e) => [e.id, e.reihenfolge]));
    for (const [platz, id] of eindeutig.entries()) {
      if (bisher.get(id) === platz) continue;
      await tx
        .update(gespeicherteAnsichten)
        .set({ reihenfolge: platz, geaendertAm: new Date() })
        .where(eq(gespeicherteAnsichten.id, id));
    }
    return true;
  });
}
