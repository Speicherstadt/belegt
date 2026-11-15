import { Worker } from "node:worker_threads";

/*
 * Reguläre Ausdrücke aus Zuordnungsregeln mit Zeitlimit. Die Engine von JavaScript (in Bun JavaScriptCore) kennt kein
 * Zeitlimit, und ein Ausdruck wie (a+)+$ braucht auf „aaaa…!“ exponentiell lange (katastrophales Backtracking). RE2
 * gäbe es nur als native Abhängigkeit. Deshalb läuft jeder Ausdruck in einem eigenen Thread (node:worker_threads, in
 * Bun und Node gleich); antwortet er nicht innerhalb des Zeitlimits, wird der Thread beendet und der Ausdruck trifft
 * nicht, wie bei Paperless-ngx (src/documents/regex.py, safe_regex_search mit 0,1 Sekunden). Dazu begrenzen die Länge
 * des Ausdrucks (shared/abgleich.ts) und des Texts den Aufwand.
 */

/** Zeitlimit je Ausdruck in Millisekunden, wie MATCH_REGEX_TIMEOUT_SECONDS in Paperless-ngx */
export const REGEX_ZEITLIMIT = 100;

/** Längster Text, den ein Ausdruck durchsucht */
export const REGEX_MAX_TEXT = 200_000;

const CODE = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ muster, flags, text }) => {
  try {
    parentPort.postMessage({ treffer: new RegExp(muster, flags).test(text) });
  } catch (err) {
    parentPort.postMessage({ fehler: String(err && err.message || err) });
  }
});`;

export type RegexErgebnis = { treffer: boolean } | { fehler: "zeitlimit" | "ungueltig" };

let thread: Worker | null = null;
let warteschlange: Promise<unknown> = Promise.resolve();

/** Der Thread, bereit für Nachrichten; sein Start zählt nicht zum Zeitlimit */
async function holen(): Promise<Worker> {
  if (!thread) {
    const neu = new Worker(CODE, { eval: true });
    // Der Thread hält den Prozess nicht am Leben (Tests, Ende des Workers)
    neu.unref();
    await new Promise((bereit) => neu.once("online", bereit));
    thread = neu;
  }
  return thread;
}

async function beenden() {
  const t = thread;
  thread = null;
  await t?.terminate();
}

async function einmal(muster: string, flags: string, text: string, zeitlimit: number): Promise<RegexErgebnis> {
  const t = await holen();
  return new Promise((fertig) => {
    const aufraeumen = () => {
      clearTimeout(uhr);
      t.off("message", antwort);
      t.off("error", absturz);
    };
    const antwort = (m: { treffer?: boolean; fehler?: string }) => {
      aufraeumen();
      fertig(m.fehler === undefined ? { treffer: Boolean(m.treffer) } : { fehler: "ungueltig" });
    };
    const absturz = () => {
      aufraeumen();
      void beenden().then(() => fertig({ fehler: "ungueltig" }));
    };
    const uhr = setTimeout(() => {
      aufraeumen();
      void beenden().then(() => fertig({ fehler: "zeitlimit" }));
    }, zeitlimit);
    t.on("message", antwort);
    t.on("error", absturz);
    t.postMessage({ muster, flags, text: text.slice(0, REGEX_MAX_TEXT) });
  });
}

/**
 * Sucht den Ausdruck im Text, einer nach dem anderen im selben Thread. Ein ungültiger Ausdruck oder einer über dem
 * Zeitlimit trifft nicht; das Ergebnis sagt, warum.
 */
export function regexSuchen(
  muster: string,
  text: string,
  { grossKleinEgal = true, zeitlimit = REGEX_ZEITLIMIT }: { grossKleinEgal?: boolean; zeitlimit?: number } = {},
): Promise<RegexErgebnis> {
  const flags = grossKleinEgal ? "iu" : "u";
  const lauf = warteschlange.then(() => einmal(muster, flags, text, zeitlimit));
  warteschlange = lauf.catch(() => undefined);
  return lauf;
}
