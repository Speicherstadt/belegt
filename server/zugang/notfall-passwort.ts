import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { istEigentuemer } from "./notfall.ts";
import { linkAusstellen } from "./passwort.ts";
import { zugangPerAdresse } from "./zwei-faktor.ts";

/*
 * Notfall: Der Inhaber hat sein Passwort vergessen. Wie bei notfall.ts nur mit dem Zugang des Eigentümers der Datenbank:
 *
 *   docker compose exec server bun server/zugang/notfall-passwort.ts inhaber@firma.de
 *
 * Braucht MIGRATION_DATABASE_URL und BETTER_AUTH_URL (für die Adresse des Links). Gibt den Link einmal auf stdout aus;
 * er gilt 24 Stunden und einmal, gespeichert ist nur sein Hash, im Audit-Log steht system:notfall. Der zweite Faktor
 * bleibt. Der Link steht nirgends sonst: nicht im Log, nicht in der Datenbank.
 */

export async function notfallLink(sql: postgres.Sql, email: string, basis: string): Promise<string> {
  if (!(await istEigentuemer(sql)))
    throw new Error("Nur mit dem Eigentümer der Datenbank (MIGRATION_DATABASE_URL), nicht mit der App-Anmeldung.");
  const db = drizzle(sql);
  const zugang = await zugangPerAdresse(db, email);
  if (!zugang) throw new Error(`Kein Zugang mit der Adresse ${email}.`);
  const pfad = await linkAusstellen(db, zugang.id, "system:notfall");
  if (!pfad) throw new Error(`${zugang.email} hat kein Passwort oder ist entzogen.`);
  return new URL(pfad, basis).toString();
}

if (import.meta.main) {
  const email = process.argv[2];
  const url = process.env.MIGRATION_DATABASE_URL;
  const basis = process.env.BETTER_AUTH_URL;
  if (!email || !url || !basis) {
    console.error(
      "Aufruf: MIGRATION_DATABASE_URL=… BETTER_AUTH_URL=… bun server/zugang/notfall-passwort.ts <E-Mail-Adresse>",
    );
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    console.log(await notfallLink(sql, email, basis));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
