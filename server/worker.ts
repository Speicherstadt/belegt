import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { alleAbrufen } from "./mail/abruf.ts";
import { imapOeffnen } from "./mail/imapflow.ts";
import { zustellen } from "./webhooks/webhooks.ts";

/*
 * Worker als eigener Prozess: ruft die Postfächer alle ABRUF_MINUTEN ab und stellt alle 15 Sekunden Webhooks zu. Getrennt vom Server, damit ein hängender
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

const meldung = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function webhooks() {
  for (;;) {
    const ergebnisse = await zustellen(db, schluessel).catch((err) => {
      console.error(`Webhooks fehlgeschlagen: ${meldung(err)}`);
      return {};
    });
    for (const [name, e] of Object.entries(ergebnisse)) {
      if (e.zugestellt || e.fehler)
        console.log(`Webhook ${name}: ${e.zugestellt} zugestellt${e.fehler ? `, Fehler: ${e.fehler}` : ""}`);
    }
    await Bun.sleep(15_000);
  }
}

async function postfaecher() {
  for (;;) {
    await runde().catch((err) => console.error(`Abruf fehlgeschlagen: ${meldung(err)}`));
    await Bun.sleep(env.ABRUF_MINUTEN * 60_000);
  }
}

await Promise.all([postfaecher(), webhooks()]);
