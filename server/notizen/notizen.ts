import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { notizen, notizWiderrufe } from "../db/schema.ts";

/*
 * Notizen zu einem Dokument: nur ergänzen. „Zurückziehen“ ist ein eigener Eintrag (notiz_widerrufe), der die Notiz
 * ausblendet; ändern oder löschen lehnt Postgres ab. Mit der bestätigten Löschung des Dokuments gehen Notizen und
 * Widerrufe mit (belegt_inhalt_loeschen), denn sie sind keine Unterlage, sondern Anmerkungen dazu. Das Audit-Log hält
 * jede Notiz ohne ihren Text fest, nur mit dessen SHA-256; so bleibt nachweisbar, was stand, ohne dass der Text das
 * Dokument überlebt.
 */

export const NotizEingabe = z.object({ text: z.string().trim().min(1).max(5000) });

export interface Notiz {
  id: string;
  text: string;
  erstelltVon: string;
  erstelltAm: string;
}

/** Die Notizen eines Dokuments, die nicht zurückgezogen sind, älteste zuerst */
export async function notizenZu(db: Datenbank, dokumentId: string): Promise<Notiz[]> {
  const zeilen = await db
    .select({ id: notizen.id, text: notizen.text, erstelltVon: notizen.erstelltVon, erstelltAm: notizen.erstelltAm })
    .from(notizen)
    .leftJoin(notizWiderrufe, eq(notizWiderrufe.notizId, notizen.id))
    .where(and(eq(notizen.dokumentId, dokumentId), isNull(notizWiderrufe.notizId)))
    .orderBy(asc(notizen.erstelltAm), asc(notizen.id));
  return zeilen.map((n) => ({ ...n, erstelltAm: n.erstelltAm.toISOString() }));
}

export async function notizAnlegen(db: Datenbank, dokumentId: string, text: string, akteur: string): Promise<Notiz> {
  const [n] = await mitAkteur(db, akteur, (tx) =>
    tx.insert(notizen).values({ dokumentId, text, erstelltVon: akteur }).returning(),
  );
  return { id: n!.id, text: n!.text, erstelltVon: n!.erstelltVon, erstelltAm: n!.erstelltAm.toISOString() };
}

/**
 * Zieht eine Notiz zurück: wer sie geschrieben hat, oder der Inhaber (alle). false, wenn es sie (an diesem Dokument)
 * nicht gibt, sie schon zurückgezogen ist oder die Person es nicht darf.
 */
export async function notizZurueckziehen(
  db: Datenbank,
  { dokumentId, notizId, akteur, alle }: { dokumentId: string; notizId: string; akteur: string; alle: boolean },
): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    const [n] = await tx
      .select({ von: notizen.erstelltVon })
      .from(notizen)
      .where(and(eq(notizen.id, notizId), eq(notizen.dokumentId, dokumentId)));
    if (!n || (!alle && n.von !== akteur)) return false;
    const neu = await tx
      .insert(notizWiderrufe)
      .values({ notizId, widerrufenVon: akteur })
      .onConflictDoNothing()
      .returning({ id: notizWiderrufe.notizId });
    return neu.length > 0;
  });
}

/** Bedingung für die Suche: das Dokument hat eine Notiz, die nicht zurückgezogen ist und auf die Suche passt */
export const notizPasst = (suche: string) => sql`exists (
  select 1 from notizen n
   where n.dokument_id = d.id
     and not exists (select 1 from notiz_widerrufe w where w.notiz_id = n.id)
     and to_tsvector('german', n.text) @@ websearch_to_tsquery('german', ${suche}))`;
