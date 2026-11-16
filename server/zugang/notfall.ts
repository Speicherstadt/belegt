import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { zugangPerAdresse, zuruecksetzen } from "./zwei-faktor.ts";

/*
 * Notfall: Der Inhaber hat Telefon und Backup-Codes verloren. Den eigenen zweiten Faktor setzt er nicht in der
 * Oberfläche zurück, sondern mit dem Zugang des Eigentümers der Datenbank, den nur der Betreiber hat:
 *
 *   docker compose exec server bun server/zugang/notfall.ts inhaber@firma.de
 *
 * Braucht MIGRATION_DATABASE_URL (im Container des Servers gesetzt, docs/betrieb.md#getrennte-datenbankrollen) und
 * bricht mit der App-Anmeldung ab. Entfernt TOTP, Backup-Codes und Passkeys des Zugangs und beendet seine Sitzungen;
 * im Audit-Log steht system:notfall. Danach meldet er sich mit dem Passwort an und richtet neu ein.
 */

/** Ob die Verbindung als Eigentümer der Tabellen arbeitet (wie der Migrationsschritt) */
async function istEigentuemer(sql: postgres.Sql): Promise<boolean> {
  const [z] = await sql<
    { ok: boolean }[]
  >`select coalesce(bool_and(pg_has_role(current_user, c.relowner, 'USAGE')), false)
    as ok from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('user', 'two_factor', 'passkey')`;
  return z?.ok ?? false;
}

export async function notfallZuruecksetzen(sql: postgres.Sql, email: string): Promise<string> {
  if (!(await istEigentuemer(sql)))
    throw new Error("Nur mit dem Eigentümer der Datenbank (MIGRATION_DATABASE_URL), nicht mit der App-Anmeldung.");
  const db = drizzle(sql);
  const zugang = await zugangPerAdresse(db, email);
  if (!zugang) throw new Error(`Kein Zugang mit der Adresse ${email}.`);
  await zuruecksetzen(db, zugang.id, "system:notfall");
  return `Zweiter Faktor von ${zugang.email} zurückgesetzt; Sitzungen beendet. Jetzt mit dem Passwort anmelden und neu einrichten.`;
}

if (import.meta.main) {
  const email = process.argv[2];
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!email || !url) {
    console.error("Aufruf: MIGRATION_DATABASE_URL=… bun server/zugang/notfall.ts <E-Mail-Adresse>");
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    console.log(await notfallZuruecksetzen(sql, email));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
