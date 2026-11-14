import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { inhalteErzeugen } from "./inhalt/inhalt.ts";
import { alleAbrufen } from "./mail/abruf.ts";
import { imapOeffnen } from "./mail/imapflow.ts";
import { oauthAusEnv } from "./mail/oauth.ts";
import { speicherAusEnv } from "./speicher/auswahl.ts";
import { sperrenAbgleichen } from "./speicher/objektsperren.ts";
import type { SperrbarerSpeicher } from "./speicher/s3.ts";
import { zustellen } from "./webhooks/webhooks.ts";

/*
 * Worker als eigener Prozess: ruft die Postfächer alle ABRUF_MINUTEN ab, stellt alle 15 Sekunden Webhooks zu und liest
 * Text und E-Rechnungen neuer Dokumente. Getrennt vom Server, damit ein hängender Abruf oder eine schwere Datei keine
 * Anfrage aufhält. Migrationen wendet der Server an, nicht der Worker.
 */
const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BELEGT_SCHLUESSEL) throw new Error("BELEGT_SCHLUESSEL fehlt");
const schluessel = schluesselAus(env.BELEGT_SCHLUESSEL);
const { db } = verbinden(env.DATABASE_URL);
const { speicher, sperrbar } = speicherAusEnv(env);

async function runde() {
  const ergebnisse = await alleAbrufen({ db, speicher }, schluessel, imapOeffnen, { oauth: oauthAusEnv(env) });
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

/** Liest Text und E-Rechnungen neuer Dokumente; bei vollem Stapel gleich weiter */
async function inhalte() {
  for (;;) {
    const r = await inhalteErzeugen({ db, speicher }).catch((err) => {
      console.error(`Inhalte fehlgeschlagen: ${meldung(err)}`);
      return { gelesen: 0, fehler: 0 };
    });
    if (r.gelesen || r.fehler) console.log(`Inhalte: ${r.gelesen} gelesen, ${r.fehler} nicht lesbar`);
    if (r.gelesen + r.fehler < 20) await Bun.sleep(15_000);
  }
}

/** Mit S3: Sperren im Bucket bis zum Fristende verlängern, jede Minute */
async function objektsperren(speicher: SperrbarerSpeicher) {
  for (;;) {
    const r = await sperrenAbgleichen(db, speicher).catch((err) => ({ gesetzt: 0, fehler: meldung(err) }));
    if (r.gesetzt || r.fehler)
      console.log(`Sperren im Bucket: ${r.gesetzt} verlängert${r.fehler ? `, Fehler: ${r.fehler}` : ""}`);
    await Bun.sleep(60_000);
  }
}

async function postfaecher() {
  for (;;) {
    await runde().catch((err) => console.error(`Abruf fehlgeschlagen: ${meldung(err)}`));
    await Bun.sleep(env.ABRUF_MINUTEN * 60_000);
  }
}

await Promise.all([postfaecher(), webhooks(), inhalte(), ...(sperrbar ? [objektsperren(sperrbar)] : [])]);
