import { akteurEinstellung } from "@firsttris/gobd-kern/sql";
import { sql } from "drizzle-orm";
import type { Datenbank } from "./client.ts";

export type Tx = Parameters<Parameters<Datenbank["transaction"]>[0]>[0];

const EINSTELLUNG = akteurEinstellung("belegt");

/** Transaktion, deren Änderungen das Audit-Log dem Akteur zuschreibt (Einstellung belegt.actor) */
export function mitAkteur<T>(db: Datenbank, akteur: string, arbeit: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${EINSTELLUNG}, ${akteur}, true)`);
    return arbeit(tx);
  });
}
