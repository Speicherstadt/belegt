import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { abrufSperren } from "../db/schema.ts";

/**
 * Höchstens ein Abruf je Postfach, über alle Prozesse, ohne eine Verbindung zu halten: eine Zeile je laufendem Abruf mit
 * der Kennung ihres Laufs. Der Lauf setzt seit neu (herzschlag): je aufgenommener Mail und alle TAKT_MS, auch solange
 * er auf den Server wartet. Eine Zeile, die älter als FRIST ist, stammt von einem abgestürzten Abruf und wird
 * übernommen; der alte Lauf, falls er doch noch lebt, merkt es am Herzschlag und hört auf.
 */
const FRIST = sql`interval '10 minutes'`;
export const TAKT_MS = 60_000;

export type Sperre = { art: "frei"; inhaber: string } | { art: "laeuft" } | { art: "unbekannt" };

/** frei: der Aufruf hält die Sperre jetzt (mit seiner Kennung); laeuft: ein anderer Abruf hält sie; unbekannt: keine Quelle */
export async function sperren(db: Datenbank, quelleId: string): Promise<Sperre> {
  const inhaber = randomUUID();
  const belegt = await db
    .insert(abrufSperren)
    .select(sql`select id, ${inhaber}::uuid, now() from quellen where id = ${quelleId}`)
    .onConflictDoUpdate({
      target: abrufSperren.quelleId,
      set: { inhaber, seit: sql`now()` },
      setWhere: sql`${abrufSperren.seit} < now() - ${FRIST}`,
    })
    .returning({ id: abrufSperren.quelleId });
  if (belegt.length) return { art: "frei", inhaber };
  const [q] = await db.execute<{ id: string }>(sql`select id from quellen where id = ${quelleId}`);
  return { art: q ? "laeuft" : "unbekannt" };
}

const meine = (quelleId: string, inhaber: string) =>
  and(eq(abrufSperren.quelleId, quelleId), eq(abrufSperren.inhaber, inhaber));

/** false: die Sperre gehört dem Lauf nicht mehr */
export async function herzschlag(db: Datenbank, quelleId: string, inhaber: string): Promise<boolean> {
  const zeilen = await db
    .update(abrufSperren)
    .set({ seit: sql`now()` })
    .where(meine(quelleId, inhaber))
    .returning({ id: abrufSperren.quelleId });
  return zeilen.length > 0;
}

export const freigeben = (db: Datenbank, quelleId: string, inhaber: string) =>
  db.delete(abrufSperren).where(meine(quelleId, inhaber));
