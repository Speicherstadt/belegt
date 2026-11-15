/*
 * Zuordnungsregeln für Korrespondenten, Tags und Dokumenttypen, nach dem Vorbild von Paperless-ngx
 * (src/documents/matching.py, Funktion matches und _split_match): ein Algorithmus, ein Text und „Groß- und
 * Kleinschreibung ignorieren“ (is_insensitive, Vorgabe an). Ausgewertet wird gegen Dateiname, Mailkopf und gelesenen
 * Text eines Dokuments. Das Ergebnis ist in Belegt immer nur ein Vorschlag.
 *
 * Wortgrenzen sind hier Unicode-fähig: \b in JavaScript kennt nur ASCII und sähe in „Müller“ eine Grenze vor dem ü.
 * Reguläre Ausdrücke laufen nicht hier, sondern mit Zeitlimit in einem eigenen Thread (server/abgleich/regex.ts).
 */

export const ALGORITHMEN = [
  "keiner",
  "irgendein_wort",
  "alle_woerter",
  "exakt",
  "regex",
  "unscharf",
  "automatisch",
] as const;
export type Algorithmus = (typeof ALGORITHMEN)[number];

export interface Abgleich {
  abgleich: Algorithmus;
  abgleichText: string;
  /** Groß- und Kleinschreibung ignorieren (Paperless-ngx: is_insensitive) */
  grossKleinEgal: boolean;
}

/** Längster Text einer Regel; bei einem regulären Ausdruck begrenzt das auch, wie viel er sich vornehmen kann */
export const MAX_ABGLEICH_TEXT = 500;

/** Schwelle für „unscharf“ wie bei Paperless-ngx: rapidfuzz partial_ratio mit score_cutoff=90 */
export const UNSCHARF_SCHWELLE = 90;

const RAND_VOR = "(?<![\\p{L}\\p{N}_])";
const RAND_NACH = "(?![\\p{L}\\p{N}_])";

const maskieren = (t: string) => t.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/**
 * Wörter einer Regel wie _split_match in Paperless-ngx: Leerraum trennt, Wörter in Anführungszeichen bleiben
 * zusammen, und Leerraum darin passt auf beliebigen Leerraum. Ergebnis: Muster für reguläre Ausdrücke.
 */
export function woerter(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((t) => (t[1] ?? t[2] ?? "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((w) => maskieren(w).replace(/ /g, "\\s+"));
}

const mitRand = (muster: string, grossKleinEgal: boolean) =>
  new RegExp(`${RAND_VOR}${muster}${RAND_NACH}`, grossKleinEgal ? "iu" : "u");

/** Ähnlichkeit zweier Texte in Prozent wie rapidfuzz ratio: 100 · 2 · LCS / (Länge a + Länge b) (InDel-Abstand) */
export function aehnlichkeit(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  const x = [...a];
  const y = [...b];
  let vorher = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const jetzt = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++)
      jetzt[j] = x[i - 1] === y[j - 1] ? vorher[j - 1]! + 1 : Math.max(vorher[j]!, jetzt[j - 1]!);
    vorher = jetzt;
  }
  return (200 * vorher[y.length]!) / (x.length + y.length);
}

/** Höchstens so viele Zeichen des Dokuments prüft „unscharf“; danach würde der Vergleich zu teuer */
const UNSCHARF_MAX_TEXT = 50_000;

/**
 * Teilähnlichkeit wie rapidfuzz partial_ratio: das Muster gegen jedes gleich lange Stück des Texts, das an einem
 * Wortanfang beginnt; der beste Wert zählt. Satzzeichen fallen vorher weg (wie in matching.py).
 */
export function teilAehnlichkeit(muster: string, text: string): number {
  const m = [...muster];
  if (!m.length) return 0;
  const t = [...text.slice(0, UNSCHARF_MAX_TEXT)];
  if (t.length <= m.length) return aehnlichkeit(muster, t.join(""));
  let beste = 0;
  // Am Ende des Texts darf das Stück kürzer sein, wie bei partial_ratio
  for (let i = 0; i < t.length; i++) {
    if (i > 0 && !/\s/u.test(t[i - 1]!)) continue;
    if (/\s/u.test(t[i]!)) continue;
    const wert = aehnlichkeit(muster, t.slice(i, i + m.length).join(""));
    if (wert > beste) beste = wert;
    if (beste === 100) break;
  }
  return beste;
}

const ohneSatzzeichen = (t: string) => t.replace(/[^\p{L}\p{N}_\s]/gu, "");

/**
 * Ob eine Regel auf den Text passt; null bei „regex“ (das prüft server/abgleich/regex.ts mit Zeitlimit) und bei
 * „automatisch“ (keine Regel mit Text). Ein leerer Text trifft nie (wie in matching.py).
 */
export function trifft(regel: Abgleich, text: string): boolean | null {
  const muster = regel.abgleichText.trim();
  if (regel.abgleich === "regex" || regel.abgleich === "automatisch") return null;
  if (!muster || regel.abgleich === "keiner") return false;
  switch (regel.abgleich) {
    case "irgendein_wort":
      return woerter(muster).some((w) => mitRand(w, regel.grossKleinEgal).test(text));
    case "alle_woerter":
      return woerter(muster).every((w) => mitRand(w, regel.grossKleinEgal).test(text));
    case "exakt":
      return mitRand(maskieren(muster), regel.grossKleinEgal).test(text);
    case "unscharf": {
      const klein = (t: string) => (regel.grossKleinEgal ? t.toLowerCase() : t);
      return (
        teilAehnlichkeit(klein(ohneSatzzeichen(muster)), klein(ohneSatzzeichen(text).replace(/\s+/g, " "))) >=
        UNSCHARF_SCHWELLE
      );
    }
  }
}

/** Ob ein regulärer Ausdruck gültig ist (für die Prüfung beim Anlegen); Flags wie bei der Auswertung */
export function regexGueltig(muster: string): boolean {
  try {
    new RegExp(muster, "u");
    return true;
  } catch {
    return false;
  }
}
