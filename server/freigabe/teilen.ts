import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { freigabeAbrufe, freigaben, freigabeWiderrufe } from "../db/schema.ts";
import { freigeben, tokenGueltig, tokenHash } from "./freigabe.ts";

/*
 * Teilen per Link: Der Inhaber gibt jemandem ohne Zugang das Original eines Dokuments, für 1, 7 oder 30 Tage. Der Link
 * ist eine Freigabe mit Zweck „teilen“ (freigaben, nur ihr Hash gespeichert); Widerruf und jeder Abruf stehen in eigenen
 * Tabellen, die nur anwachsen, mit Audit-Log. Postgres lässt einen widerrufenen oder abgelaufenen Link nicht abrufen.
 */

export const TAGE = [1, 7, 30] as const;
export type Tage = (typeof TAGE)[number];

export interface GeteilterLink {
  id: string;
  erstelltVon: string;
  erstelltAm: Date;
  gueltigBis: Date;
  abrufe: number;
  letzterAbruf: Date | null;
}

/** Legt einen Link an; den Klartext gibt es nur hier */
export function teilen(db: Datenbank, dokumentId: string, akteur: string, tage: Tage) {
  return freigeben(db, dokumentId, akteur, tage * 24 * 60, "teilen");
}

// Spalten der äußeren Tabelle in Unterabfragen ausgeschrieben: Drizzle ließe den Tabellennamen weg, und "id" träfe
// dann die innere Tabelle
const gilt = () =>
  and(
    eq(freigaben.zweck, "teilen"),
    gt(freigaben.gueltigBis, sql`now()`),
    sql`not exists (select 1 from ${freigabeWiderrufe} w where w.freigabe_id = "freigaben"."id")`,
  );

/** Link und Dokument eines gültigen, nicht widerrufenen geteilten Links oder null */
export async function einloesenGeteilt(
  db: Datenbank,
  token: string,
): Promise<{ freigabeId: string; dokumentId: string } | null> {
  if (!tokenGueltig(token)) return null;
  const [f] = await db
    .select({ freigabeId: freigaben.id, dokumentId: freigaben.dokumentId })
    .from(freigaben)
    .where(and(eq(freigaben.tokenHash, tokenHash(token)), gilt()));
  return f ?? null;
}

/** Hält einen Abruf fest; false, wenn der Link inzwischen widerrufen oder abgelaufen ist (Postgres lehnt dann ab) */
export async function abrufFesthalten(db: Datenbank, freigabeId: string): Promise<boolean> {
  try {
    await mitAkteur(db, `link:${freigabeId}`, (tx) => tx.insert(freigabeAbrufe).values({ freigabeId }));
    return true;
  } catch {
    return false;
  }
}

/** Die gültigen Links eines Dokuments, neueste zuerst, mit Zahl und Zeit der Abrufe */
export async function geteilteListen(db: Datenbank, dokumentId: string): Promise<GeteilterLink[]> {
  const zeilen = await db
    .select({
      id: freigaben.id,
      erstelltVon: freigaben.erstelltVon,
      erstelltAm: freigaben.erstelltAm,
      gueltigBis: freigaben.gueltigBis,
      abrufe: sql<number>`(select count(*)::int from ${freigabeAbrufe} a where a.freigabe_id = "freigaben"."id")`,
      letzterAbruf: sql<
        string | null
      >`(select max(a.abgerufen_am) from ${freigabeAbrufe} a where a.freigabe_id = "freigaben"."id")`,
    })
    .from(freigaben)
    .where(and(eq(freigaben.dokumentId, dokumentId), gilt()))
    .orderBy(desc(freigaben.erstelltAm));
  return zeilen.map((z) => ({ ...z, letzterAbruf: z.letzterAbruf ? new Date(z.letzterAbruf) : null }));
}

/** Widerruft einen gültigen geteilten Link des Dokuments; false, wenn es keinen solchen gibt */
export async function widerrufen(
  db: Datenbank,
  dokumentId: string,
  freigabeId: string,
  akteur: string,
): Promise<boolean> {
  // Zwei gleichzeitige Widerrufe: Der zweite scheitert am Primärschlüssel und gilt als „schon widerrufen“
  return mitAkteur(db, akteur, async (tx) => {
    const [f] = await tx
      .select({ id: freigaben.id })
      .from(freigaben)
      .leftJoin(freigabeWiderrufe, eq(freigabeWiderrufe.freigabeId, freigaben.id))
      .where(
        and(
          eq(freigaben.id, freigabeId),
          eq(freigaben.dokumentId, dokumentId),
          eq(freigaben.zweck, "teilen"),
          gt(freigaben.gueltigBis, sql`now()`),
          isNull(freigabeWiderrufe.freigabeId),
        ),
      );
    if (!f) return false;
    await tx.insert(freigabeWiderrufe).values({ freigabeId, widerrufenVon: akteur });
    return true;
  }).catch(() => false);
}

/** Wie viele geteilte Links es gibt und wie viele gerade gelten (für die Verfahrensdokumentation) */
export async function geteiltZahlen(db: Datenbank): Promise<{ jemals: number; aktiv: number }> {
  const [z] = await db
    .select({
      jemals: sql<number>`count(*)::int`,
      aktiv: sql<number>`(count(*) filter (where ${gilt()}))::int`,
    })
    .from(freigaben)
    .where(eq(freigaben.zweck, "teilen"));
  return { jemals: z?.jemals ?? 0, aktiv: z?.aktiv ?? 0 };
}
