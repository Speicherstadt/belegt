import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Ordner mit den Migrationen von drizzle-kit */
export const MIGRATIONEN = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Wendet alle Migrationen an; ohne Migrationen (Journal von drizzle-kit fehlt) geschieht nichts */
export async function migrieren(url: string, ordner = MIGRATIONEN): Promise<void> {
  if (!existsSync(join(ordner, "meta", "_journal.json"))) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: ordner });
  } finally {
    await sql.end();
  }
}
