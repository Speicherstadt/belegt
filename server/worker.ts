import { zuordnungVorschlaegeErzeugen } from "./abgleich/vorschlaege.ts";
import { ansichtenErzeugen } from "./ansicht/ansicht.ts";
import { archivfassungenErzeugen } from "./archivfassung/archivfassung.ts";
import { benachrichtigen } from "./benachrichtigungen/benachrichtigen.ts";
import { mailAusEnv, type Versender } from "./benachrichtigungen/versand.ts";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { zugriffLesen, zugriffWarnung } from "./db/rollen.ts";
import { readEnv } from "./env.ts";
import { inhalteErzeugen } from "./inhalt/inhalt.ts";
import { ocrVerfuegbar } from "./inhalt/ocr.ts";
import { kiVorschlaegeErzeugen } from "./ki/vorschlaege.ts";
import { klassifikatorLernen } from "./lernen/lernen.ts";
import { entfernenNachholen } from "./loeschung/loeschung.ts";
import { alleAbrufen } from "./mail/abruf.ts";
import { imapOeffnen } from "./mail/imapflow.ts";
import { oauthAusEnv } from "./mail/oauth.ts";
import { ordnerEinlesen, type Zustand } from "./ordner/ordner.ts";
import { naechsterImport } from "./paperless/ausfuehren.ts";
import { speicherAusEnv } from "./speicher/auswahl.ts";
import { sperrenAbgleichen } from "./speicher/objektsperren.ts";
import type { SperrbarerSpeicher } from "./speicher/s3.ts";
import { dateiTeilen } from "./trennen/trennen.ts";
import { rasterVerfuegbar } from "./vorschaubild/raster.ts";
import { vorschaubilderErzeugen } from "./vorschaubild/vorschaubild.ts";
import { zustellen } from "./webhooks/webhooks.ts";
import { workflowsAusfuehren } from "./workflows/ausfuehren.ts";
import { zeitstempelSetzen } from "./zeitstempel/zeitstempel.ts";

/*
 * Worker als eigener Prozess: ruft die Postfächer alle ABRUF_MINUTEN ab und führt danach fällige Aktionen dort aus, stellt alle 15 Sekunden Webhooks zu, liest
 * Text und E-Rechnungen neuer Dokumente, führt Workflows aus, wertet Zuordnungsregeln aus, lernt aus den Einordnungen, importiert aus Paperless-ngx und, wenn eingerichtet, liest den Eingangsordner
 * und erzeugt Vorschaubilder und durchsuchbare PDFs von Scans; mit MAIL_SMTP_URL verschickt er Benachrichtigungen. Getrennt vom Server, damit ein hängender Abruf oder eine schwere Datei keine Anfrage
 * aufhält. Migrationen wendet der Server an, nicht der Worker.
 */
const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BELEGT_SCHLUESSEL) throw new Error("BELEGT_SCHLUESSEL fehlt");
const schluessel = schluesselAus(env.BELEGT_SCHLUESSEL);
const { db, sql } = verbinden(env.DATABASE_URL);
// Mehr Rechte als nötig: Warnung im Log, Betrieb wie bisher (docs/betrieb.md, „Getrennte Datenbankrollen“)
const warnung = zugriffWarnung(await zugriffLesen(sql));
if (warnung) console.warn(`Worker: ${warnung}`);
const { speicher, sperrbar } = speicherAusEnv(env);

async function runde() {
  const ergebnisse = await alleAbrufen({ db, speicher }, schluessel, imapOeffnen, { oauth: oauthAusEnv(env) });
  for (const [name, e] of Object.entries(ergebnisse)) {
    console.log(`Abruf ${name}: ${e.neu} neu, ${e.doppelt} doppelt${e.fehler ? `, Fehler: ${e.fehler}` : ""}`);
    const a = e.aktionen;
    if (a.ausgefuehrt || a.entfallen || a.fehler)
      console.log(
        `Aktionen im Postfach ${name}: ${a.ausgefuehrt} ausgeführt, ${a.entfallen} entfallen, ${a.fehler} Fehler`,
      );
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

/** Workflows für neue und eingeordnete Dokumente, alle 5 Sekunden; bei vollem Stapel gleich weiter */
async function workflows() {
  for (;;) {
    const r = await workflowsAusfuehren(db).catch((err) => {
      console.error(`Workflows fehlgeschlagen: ${meldung(err)}`);
      return { ausgefuehrt: 0, fehler: 0, wartet: 0 };
    });
    if (r.ausgefuehrt || r.fehler) console.log(`Workflows: ${r.ausgefuehrt} ausgeführt, ${r.fehler} fehlgeschlagen`);
    if (r.ausgefuehrt + r.fehler < 50) await Bun.sleep(5_000);
  }
}

/** Zuordnungsregeln für Dokumente im Eingang, sobald ihr Text gelesen ist, alle 10 Sekunden */
async function zuordnungen() {
  for (;;) {
    const r = await zuordnungVorschlaegeErzeugen(db).catch((err) => {
      console.error(`Zuordnungsregeln fehlgeschlagen: ${meldung(err)}`);
      return { ausgewertet: 0, treffer: 0 };
    });
    if (r.ausgewertet) console.log(`Zuordnungsregeln: ${r.ausgewertet} ausgewertet, ${r.treffer} mit Vorschlag`);
    if (r.ausgewertet < 20) await Bun.sleep(10_000);
  }
}

/** Lernt aus den Einordnungen neu, wenn sich etwas getan hat (oder eine Löschung das Modell entfernt hat), alle 10 Minuten */
async function lernen() {
  for (;;) {
    await klassifikatorLernen(db).then(
      (r) => r.gelernt && console.log(`Gelernte Vorschläge: aus ${r.beispiele} Dokumenten gelernt`),
      (err) => console.error(`Lernen fehlgeschlagen: ${meldung(err)}`),
    );
    await Bun.sleep(600_000);
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

/**
 * Mit KI_URL und KI_MODELL: Vorschläge zur Einordnung für den Eingang, alle 30 Sekunden; mit VORSCHAU_URL warten alte
 * Office-Formate auf ihren Text aus der Ansicht
 */
async function kiVorschlaege(konfig: { url: string; modell: string }) {
  for (;;) {
    const r = await kiVorschlaegeErzeugen(db, konfig, { vorschau: Boolean(env.VORSCHAU_URL) }).catch((err) => ({
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

/** Mit pdftoppm: Vorschaubilder der ersten Seite, alle 15 Sekunden; bei vollem Stapel gleich weiter */
async function vorschaubilder() {
  for (;;) {
    const r = await vorschaubilderErzeugen({ db, speicher }).catch((err) => ({
      erzeugt: 0,
      fehler: 0,
      meldung: meldung(err),
    }));
    if (r.erzeugt || r.fehler) console.log(`Vorschaubilder: ${r.erzeugt} erzeugt, ${r.fehler} nicht möglich`);
    if ("meldung" in r) console.error(`Vorschaubilder: ${r.meldung}`);
    if (r.erzeugt + r.fehler < 10) await Bun.sleep(15_000);
  }
}

/** Mit Tesseract und ARCHIVFASSUNG: durchsuchbare PDFs von Scans, alle 30 Sekunden; bei vollem Stapel gleich weiter */
async function archivfassungen() {
  for (;;) {
    const r = await archivfassungenErzeugen({ db, speicher }).catch((err) => ({
      erzeugt: 0,
      fehler: 0,
      meldung: meldung(err),
    }));
    if (r.erzeugt || r.fehler) console.log(`Archivfassungen: ${r.erzeugt} erzeugt, ${r.fehler} nicht möglich`);
    if ("meldung" in r) console.error(`Archivfassungen: ${r.meldung}`);
    if (r.erzeugt + r.fehler < 3) await Bun.sleep(30_000);
  }
}

/**
 * Mit EINGANG_ORDNER: alle 5 Sekunden ein Blick in den Ordner; aufgenommen wird, was zwei Blicke lang gleich bleibt.
 * PDFs mit Trennblättern werden vorher geteilt; scheitert das, kommt der Stapel unverändert ins Archiv.
 */
async function eingangsordner(ordner: string) {
  let zustand: Zustand = new Map();
  let letzterFehler = "";
  // Ein unlesbarer Unterordner steht einmal im Log, nicht alle 5 Sekunden
  let letzteUebersprungen = "";
  const teilen = (bytes: Uint8Array, name: string) =>
    dateiTeilen(bytes, name, { code: env.TRENNBLATT_CODE }).catch((err) => {
      console.error(`Eingangsordner: ${name} nicht geteilt, unverändert aufgenommen: ${meldung(err)}`);
      return null;
    });
  for (;;) {
    try {
      const r = await ordnerEinlesen(
        { db, speicher },
        { ordner, zustand, teilen, ordnerTags: env.EINGANG_ORDNER_TAGS },
      );
      zustand = r.zustand;
      letzterFehler = "";
      const { neu, doppelt, fehler, spaeter } = r.ergebnis;
      if (neu || doppelt) console.log(`Eingangsordner: ${neu} aufgenommen, ${doppelt} schon im Archiv`);
      for (const f of fehler) console.error(`Eingangsordner: ${f.datei} nach fehler/ verschoben: ${f.meldung}`);
      for (const f of spaeter) console.error(`Eingangsordner: ${f.datei} später noch einmal: ${f.meldung}`);
      const uebersprungen = r.ergebnis.uebersprungen.map((u) => `${u.ordner} (${u.meldung})`).join(", ");
      if (uebersprungen && uebersprungen !== letzteUebersprungen)
        console.error(`Eingangsordner: Unterordner übersprungen, nicht lesbar: ${uebersprungen}`);
      letzteUebersprungen = uebersprungen;
    } catch (err) {
      // Fehlt der Ordner etwa, steht das einmal im Log, nicht alle 5 Sekunden
      if (meldung(err) !== letzterFehler) console.error(`Eingangsordner: ${meldung(err)}`);
      letzterFehler = meldung(err);
    }
    await Bun.sleep(5_000);
  }
}

/** Importe aus Paperless-ngx (API und Export), einer nach dem anderen; alle 10 Sekunden ein Blick, ob einer wartet */
async function paperless() {
  for (;;) {
    const r = await naechsterImport({ db, speicher }, { schluessel, importOrdner: env.IMPORT_ORDNER }).catch((err) => {
      console.error(`Import aus Paperless-ngx fehlgeschlagen: ${meldung(err)}`);
      return null;
    });
    if (r) console.log(`Import aus Paperless-ngx ${r.id}: ${r.status}${r.meldung ? `, ${r.meldung}` : ""}`);
    else await Bun.sleep(10_000);
  }
}

/**
 * Mit MAIL_SMTP_URL: Benachrichtigungen alle 15 Minuten, die Prüfung der Kette dabei einmal am Tag (ab dem Start). Ins
 * Log kommen nur Zahlen, nie Adresse oder Passwort des SMTP-Servers.
 */
async function benachrichtigungen(versender: Versender) {
  let letztePruefung = 0;
  for (;;) {
    const jetzt = new Date();
    const kettePruefen = jetzt.getTime() - letztePruefung >= 86_400_000;
    const r = await benachrichtigen(
      { db, versender, basisUrl: env.BETTER_AUTH_URL },
      { jetzt, heute: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt), kettePruefen },
    ).catch((err) => {
      console.error(`Benachrichtigungen fehlgeschlagen: ${meldung(err)}`);
      return null;
    });
    if (r && kettePruefen) letztePruefung = jetzt.getTime();
    if (r && (r.gesendet || r.fehler))
      console.log(`Benachrichtigungen: ${r.gesendet} gesendet${r.fehler ? `, ${r.fehler} nicht zugestellt` : ""}`);
    await Bun.sleep(900_000);
  }
}

const mail = mailAusEnv(env);
if (!mail) console.log("Benachrichtigungen per Mail aus: MAIL_SMTP_URL fehlt");

async function postfaecher() {
  for (;;) {
    await runde().catch((err) => console.error(`Abruf fehlgeschlagen: ${meldung(err)}`));
    await Bun.sleep(env.ABRUF_MINUTEN * 60_000);
  }
}

await Promise.all([
  postfaecher(),
  paperless(),
  webhooks(),
  inhalte(),
  workflows(),
  zuordnungen(),
  lernen(),
  entfernungen(),
  ...(rasterVerfuegbar() ? [vorschaubilder()] : []),
  ...(env.ARCHIVFASSUNG && ocrVerfuegbar() ? [archivfassungen()] : []),
  ...(sperrbar ? [objektsperren(sperrbar)] : []),
  ...(env.EINGANG_ORDNER ? [eingangsordner(env.EINGANG_ORDNER)] : []),
  ...(env.TSA_URL ? [zeitstempel(env.TSA_URL)] : []),
  ...(mail ? [benachrichtigungen(mail.versender)] : []),
  ...(env.VORSCHAU_URL ? [ansichten(env.VORSCHAU_URL)] : []),
  ...(env.KI_URL && env.KI_MODELL ? [kiVorschlaege({ url: env.KI_URL, modell: env.KI_MODELL })] : []),
]);
