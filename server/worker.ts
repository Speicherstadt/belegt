import { ansichtenErzeugen } from "./ansicht/ansicht.ts";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { inhalteErzeugen } from "./inhalt/inhalt.ts";
import { kiVorschlaegeErzeugen } from "./ki/vorschlaege.ts";
import { entfernenNachholen } from "./loeschung/loeschung.ts";
import { alleAbrufen } from "./mail/abruf.ts";
import { imapOeffnen } from "./mail/imapflow.ts";
import { oauthAusEnv } from "./mail/oauth.ts";
import { ordnerEinlesen, type Zustand } from "./ordner/ordner.ts";
import { speicherAusEnv } from "./speicher/auswahl.ts";
import { sperrenAbgleichen } from "./speicher/objektsperren.ts";
import type { SperrbarerSpeicher } from "./speicher/s3.ts";
import { zustellen } from "./webhooks/webhooks.ts";
import { zeitstempelSetzen } from "./zeitstempel/zeitstempel.ts";

/*
 * Worker als eigener Prozess: ruft die Postfächer alle ABRUF_MINUTEN ab, stellt alle 15 Sekunden Webhooks zu, liest
 * Text und E-Rechnungen neuer Dokumente und, wenn eingerichtet, den Eingangsordner. Getrennt vom Server, damit ein
 * hängender Abruf oder eine schwere Datei keine Anfrage aufhält. Migrationen wendet der Server an, nicht der Worker.
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

/** Dateien gelöschter Dokumente, die der Speicher noch nicht entfernen durfte (S3: gesperrt), stündlich wieder */
async function entfernungen() {
  for (;;) {
    const r = await entfernenNachholen(db, speicher).catch((err) => ({ entfernt: 0, fehler: meldung(err) }));
    if (r.entfernt || r.fehler)
      console.log(`Gelöschte Dateien: ${r.entfernt} entfernt${r.fehler ? `, noch nicht: ${r.fehler}` : ""}`);
    await Bun.sleep(3_600_000);
  }
}

/** Mit TSA_URL: einmal am Tag ein Zeitstempel über den Kopf der Kette, wenn etwas dazukam */
async function zeitstempel(dienst: string) {
  for (;;) {
    await zeitstempelSetzen(db, dienst, { abstandStunden: 24 }).then(
      (z) => z && console.log(`Zeitstempel über Eintrag ${z.seq}: ${z.zeit.toISOString()}`),
      (err) => console.error(`Zeitstempel fehlgeschlagen: ${meldung(err)}`),
    );
    await Bun.sleep(3_600_000);
  }
}

/** Mit KI_URL und KI_MODELL: Vorschläge zur Einordnung für den Eingang, alle 30 Sekunden */
async function kiVorschlaege(konfig: { url: string; modell: string }) {
  for (;;) {
    const r = await kiVorschlaegeErzeugen(db, konfig).catch((err) => ({
      erzeugt: 0,
      fehler: 1,
      meldung: meldung(err),
    }));
    if (r.erzeugt || r.fehler) console.log(`KI-Vorschläge: ${r.erzeugt} erzeugt, ${r.fehler} fehlgeschlagen`);
    if (r.erzeugt + r.fehler < 5) await Bun.sleep(30_000);
  }
}

/** Mit VORSCHAU_URL: Ansichten als PDF für Office-Dateien, alle 30 Sekunden */
async function ansichten(url: string) {
  for (;;) {
    const r = await ansichtenErzeugen({ db, speicher }, url).catch((err) => ({
      erzeugt: 0,
      fehler: 0,
      meldung: meldung(err),
    }));
    if (r.erzeugt || r.fehler) console.log(`Ansichten: ${r.erzeugt} erzeugt, ${r.fehler} nicht umwandelbar`);
    if ("meldung" in r) console.error(`Ansichten: ${r.meldung}`);
    if (r.erzeugt + r.fehler < 5) await Bun.sleep(30_000);
  }
}

/** Mit EINGANG_ORDNER: alle 5 Sekunden ein Blick in den Ordner; aufgenommen wird, was zwei Blicke lang gleich bleibt */
async function eingangsordner(ordner: string) {
  let zustand: Zustand = new Map();
  let letzterFehler = "";
  for (;;) {
    try {
      const r = await ordnerEinlesen({ db, speicher }, { ordner, zustand });
      zustand = r.zustand;
      letzterFehler = "";
      const { neu, doppelt, fehler, spaeter } = r.ergebnis;
      if (neu || doppelt) console.log(`Eingangsordner: ${neu} aufgenommen, ${doppelt} schon im Archiv`);
      for (const f of fehler) console.error(`Eingangsordner: ${f.datei} nach fehler/ verschoben: ${f.meldung}`);
      for (const f of spaeter) console.error(`Eingangsordner: ${f.datei} später noch einmal: ${f.meldung}`);
    } catch (err) {
      // Fehlt der Ordner etwa, steht das einmal im Log, nicht alle 5 Sekunden
      if (meldung(err) !== letzterFehler) console.error(`Eingangsordner: ${meldung(err)}`);
      letzterFehler = meldung(err);
    }
    await Bun.sleep(5_000);
  }
}

async function postfaecher() {
  for (;;) {
    await runde().catch((err) => console.error(`Abruf fehlgeschlagen: ${meldung(err)}`));
    await Bun.sleep(env.ABRUF_MINUTEN * 60_000);
  }
}

await Promise.all([
  postfaecher(),
  webhooks(),
  inhalte(),
  entfernungen(),
  ...(sperrbar ? [objektsperren(sperrbar)] : []),
  ...(env.EINGANG_ORDNER ? [eingangsordner(env.EINGANG_ORDNER)] : []),
  ...(env.TSA_URL ? [zeitstempel(env.TSA_URL)] : []),
  ...(env.VORSCHAU_URL ? [ansichten(env.VORSCHAU_URL)] : []),
  ...(env.KI_URL && env.KI_MODELL ? [kiVorschlaege({ url: env.KI_URL, modell: env.KI_MODELL })] : []),
]);
