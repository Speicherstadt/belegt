import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { alleAbrufen } from "./mail/abruf.ts";
import { imapOeffnen } from "./mail/imapflow.ts";

/*
 * Worker als eigener Prozess: ruft die Postfächer alle ABRUF_MINUTEN ab. Getrennt vom Server, damit ein hängender
 * Abruf keine Anfrage aufhält. Migrationen wendet der Server an, nicht der Worker.
 */
const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BELEGT_SCHLUESSEL) throw new Error("BELEGT_SCHLUESSEL fehlt");
const schluessel = schluesselAus(env.BELEGT_SCHLUESSEL);
const { db } = verbinden(env.DATABASE_URL);
const speicher = dateispeicher({ verzeichnis: () => env.DOCUMENTS_DIR });

async function runde() {
  const ergebnisse = await alleAbrufen({ db, speicher }, schluessel, imapOeffnen);
  for (const [name, e] of Object.entries(ergebnisse)) {
    console.log(`Abruf ${name}: ${e.neu} neu, ${e.doppelt} doppelt${e.fehler ? `, Fehler: ${e.fehler}` : ""}`);
  }
}

for (;;) {
  await runde().catch((err) => console.error(`Abruf fehlgeschlagen: ${err instanceof Error ? err.message : err}`));
  await Bun.sleep(env.ABRUF_MINUTEN * 60_000);
}
