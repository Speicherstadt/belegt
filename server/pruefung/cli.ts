import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { dateienPruefen, pruefen } from "../dokumente/dokumente.ts";
import { readEnv } from "../env.ts";
import { speicherAusEnv } from "../speicher/auswahl.ts";
import { bericht } from "./bericht.ts";
import { alsText } from "./text.ts";

/*
 * Die Prüfung von „Prüfung“ mit „Auch alle Dateien prüfen“ als Kommando, für den Test-Restore (deploy/backup):
 * Hash-Kette, Kopf und Siegel aus Postgres, dazu jedes Original im Speicher gegen seinen Hash.
 *
 *   bun server/pruefung/cli.ts
 *
 * Mit --text statt JSON eine Zeile auf Deutsch (für backup_status).
 *
 * Datenbank aus DATABASE_URL oder den Variablen PGHOST, PGPORT, PGUSER, PGPASSWORD und PGDATABASE; Dateien aus
 * DOCUMENTS_DIR oder S3 (S3_ENDPUNKT …), wie beim Server. Schreibt eine Zeile JSON und endet mit 0, wenn alles stimmt,
 * mit 1 bei Befunden. Ändert nichts.
 */
const env = readEnv();
const sql = env.DATABASE_URL
  ? postgres(env.DATABASE_URL, { max: 2, onnotice: () => {} })
  : postgres({ max: 2, onnotice: () => {} });
try {
  const db = drizzle(sql);
  const { speicher } = speicherAusEnv(env);
  const kopf = await bericht(db);
  const befunde = await pruefen(db);
  const dateien = await dateienPruefen({ db, speicher });
  const alle = [...befunde, ...dateien.befunde];
  const ergebnis = {
    ok: alle.length === 0,
    befunde: alle,
    dokumente: kopf.dokumente,
    siegel: kopf.siegel,
    protokoll: kopf.protokoll,
    dateienGeprueft: dateien.geprueft,
    pruefwert: kopf.pruefwert,
  };
  console.log(process.argv.includes("--text") ? alsText(ergebnis) : JSON.stringify(ergebnis));
  process.exitCode = alle.length === 0 ? 0 : 1;
} finally {
  await sql.end();
}
