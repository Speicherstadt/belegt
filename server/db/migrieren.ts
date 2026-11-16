import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { appAnmeldungPruefen, type Datenbankzugriff, rechteVergeben, zugriffLesen } from "./rollen.ts";

/** Ordner mit den Migrationen von drizzle-kit */
export const MIGRATIONEN = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Zwei gleichzeitig startende Server migrieren nacheinander statt gegeneinander („belegt“ als Zahl) */
const SPERRE = 0x62656c656774;

const journal = (ordner: string) => join(ordner, "meta", "_journal.json");

/** Wendet alle Migrationen an; ohne Migrationen (Journal von drizzle-kit fehlt) geschieht nichts */
export async function migrieren(url: string, ordner = MIGRATIONEN): Promise<void> {
  if (!existsSync(journal(ordner))) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${SPERRE})`;
    await migrate(drizzle(sql), { migrationsFolder: ordner });
  } finally {
    await sql.end();
  }
}

/**
 * Getrennte Rollen: migriert mit der Eigentümerverbindung und vergibt danach der App-Anmeldung genau ihre Rechte, auch
 * wenn keine Migration neu war. Beide Anmeldungen werden vor der ersten Änderung geprüft; stimmt etwas nicht, bricht
 * der Start ab, statt mit dem Eigentümer weiterzulaufen.
 */
export async function migrierenMitRechten(
  migrationUrl: string,
  appUrl: string,
  ordner = MIGRATIONEN,
): Promise<Datenbankzugriff> {
  const eigentuemer = postgres(migrationUrl, { max: 1, onnotice: () => {} });
  const app = postgres(appUrl, { max: 1, onnotice: () => {} });
  try {
    await eigentuemer`select pg_advisory_lock(${SPERRE})`;
    const anmeldung = await appAnmeldungPruefen(eigentuemer, app, SPERRE);
    if (existsSync(journal(ordner))) await migrate(drizzle(eigentuemer), { migrationsFolder: ordner });
    return await rechteVergeben(eigentuemer, anmeldung);
  } finally {
    await Promise.all([eigentuemer.end(), app.end()]);
  }
}

/** Ob die neueste Migration aus dem Journal angewendet ist; drizzle speichert ihren Zeitpunkt (when) als created_at */
export async function migrationenAktuell(sql: postgres.Sql, ordner = MIGRATIONEN): Promise<boolean> {
  if (!existsSync(journal(ordner))) return true;
  const eintraege: { when: number }[] = JSON.parse(readFileSync(journal(ordner), "utf8")).entries;
  const neueste = Math.max(...eintraege.map((e) => e.when));
  const [z] = await sql<{ letzte: string | null }[]>`
    select max(created_at)::text as letzte from drizzle.__drizzle_migrations`.catch(() => [{ letzte: null }]);
  return z?.letzte !== null && z?.letzte !== undefined && Number(z.letzte) >= neueste;
}

/**
 * Was der Server vor dem Start mit der Datenbank tut:
 * - mit MIGRATION_DATABASE_URL: migrieren und Rechte vergeben (getrennte Rollen);
 * - ohne, mit einer Anmeldung ohne Eigentum und Adminrechte: Das Startskript hat schon migriert (server/start.sh); fehlt eine
 *   Migration, startet der Server nicht;
 * - ohne und mit Eigentümer-Anmeldung (bestehende Installationen): migrieren wie bisher, mit Warnung im Log.
 * Gibt die Warnung für Log und Oberfläche zurück.
 */
export async function datenbankVorbereiten(
  { appUrl, migrationUrl }: { appUrl: string; migrationUrl?: string },
  ordner = MIGRATIONEN,
): Promise<Datenbankzugriff> {
  if (migrationUrl) return migrierenMitRechten(migrationUrl, appUrl, ordner);
  const sql = postgres(appUrl, { max: 1, onnotice: () => {} });
  try {
    const zugriff = await zugriffLesen(sql);
    // Migrieren kann nur eine Anmeldung mit Eigentum oder Adminrechten; jede andere ist eine App-Anmeldung, auch mit Befunden
    if (!zugriff.probleme.some((p) => p === "admin" || p === "eigentuemer")) {
      if (!(await migrationenAktuell(sql, ordner)))
        throw new Error(
          "Migrationen fehlen und die App-Anmeldung darf sie nicht anwenden: MIGRATION_DATABASE_URL setzen (Eigentümer der Datenbank).",
        );
      return zugriff;
    }
  } finally {
    await sql.end();
  }
  await migrieren(appUrl, ordner);
  const sql2 = postgres(appUrl, { max: 1, onnotice: () => {} });
  try {
    return await zugriffLesen(sql2);
  } finally {
    await sql2.end();
  }
}
