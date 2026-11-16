import { datenbankVorbereiten } from "./db/migrieren.ts";
import { zugriffWarnung } from "./db/rollen.ts";
import { readEnv } from "./env.ts";

/*
 * Migrationsschritt vor dem Server (server/start.sh): wendet die Migrationen mit MIGRATION_DATABASE_URL an und vergibt
 * der App-Anmeldung aus DATABASE_URL ihre Rechte. Ohne MIGRATION_DATABASE_URL wie der Server selbst (bisheriger Betrieb
 * mit einer Anmeldung). Die Adressen kommen nie ins Log.
 */
const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
const zugriff = await datenbankVorbereiten({ appUrl: env.DATABASE_URL, migrationUrl: env.MIGRATION_DATABASE_URL });
const warnung = zugriffWarnung(zugriff);
if (warnung) console.warn(warnung);
console.log(
  `Migrationen angewendet; App-Anmeldung ${zugriff.anmeldung}${zugriff.eingeschraenkt ? " ist eingeschränkt" : ""}`,
);
