import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** Verbindung zur Datenbank; eine je Prozess */
export function verbinden(url: string) {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { sql, db: drizzle(sql) };
}

export type Datenbank = ReturnType<typeof verbinden>["db"];
