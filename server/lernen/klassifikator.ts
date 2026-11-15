/*
 * Lernende Vorschläge ohne externen Dienst: ein naiver Bayes-Klassifikator über die Wörter der eigenen eingeordneten
 * Dokumente, in TypeScript und ohne Datenbank. Vorbild ist der Klassifikator von Paperless-ngx
 * (src/documents/classifier.py): Er lernt nur Korrespondenten, Dokumenttypen und Tags mit dem Algorithmus
 * „automatisch“ (MATCH_AUTO), alle anderen Dokumente zählen als „keiner“ (-1), und unter einer Mindestsicherheit gibt
 * es keinen Vorschlag (_predict_with_threshold). Statt eines neuronalen Netzes (MLPClassifier) nimmt Belegt naiven
 * Bayes, weil er sich erklären lässt: Wie viele Dokumente der Klasse er gesehen hat und welche Wörter den Ausschlag
 * gaben, steht im Vorschlag.
 *
 * Jedes Wort zählt je Dokument einmal (binarisiert). Die Sicherheit dämpft lange Dokumente auf eine wirksame Länge von
 * WIRKSAME_WOERTER, sonst wäre naiver Bayes bei vielen Wörtern immer fast sicher.
 */

/** Weniger eingeordnete Dokumente: kein Modell */
export const MINDESTMENGE = 10;
/** Eine Klasse (ein Korrespondent, eine Art …) braucht so viele Beispiele */
export const MIN_JE_KLASSE = 3;
/** Sicherheit, ab der ein Vorschlag kommt */
export const SCHWELLE = 0.8;
/** Größter Wortschatz; seltene Wörter (in nur einem Dokument) zählen nie */
export const MAX_WORTSCHATZ = 20_000;
const WIRKSAME_WOERTER = 20;

const STOPPWOERTER = new Set(
  (
    "der die das den dem des ein eine einer eines einem einen und oder aber nicht mit von zu zum zur im in am an auf " +
    "aus bei für fuer ist sind war wird werden wurde hat haben sie er es wir ihr ich du sich als auch noch nur so wie " +
    "über ueber unter nach vor bis um durch ob dass wenn dann diese dieser dieses kein keine sehr mehr bitte ihre ihren " +
    "the and or of to in on at for is are was be by with from this that it as an not your you we our"
  ).split(" "),
);

/** Wörter eines Texts: klein, Unicode (NFC), mindestens ein Buchstabe, 2 bis 40 Zeichen, ohne Füllwörter, je eines */
export function woerterAus(text: string): string[] {
  const gesehen = new Set<string>();
  for (const [w] of text
    .normalize("NFC")
    .toLowerCase()
    .matchAll(/[\p{L}\p{N}]+/gu)) {
    if (w.length < 2 || w.length > 40 || !/\p{L}/u.test(w) || STOPPWOERTER.has(w)) continue;
    gesehen.add(w);
  }
  return [...gesehen];
}

export type Ziel = "art" | "korrespondent" | "dokumenttyp";

export interface Beispiel {
  woerter: string[];
  art: string | null;
  /** Nur Korrespondenten, Dokumenttypen und Tags mit „automatisch“; alles andere ist null bzw. fehlt */
  korrespondent: string | null;
  dokumenttyp: string | null;
  tags: string[];
}

/** Eine Klasse: wie viele Dokumente, die Summe ihrer Wörter und je Wort (Index im Wortschatz) die Zahl der Dokumente */
export interface Klasse {
  wert: string;
  anzahl: number;
  summe: number;
  idx: number[];
  n: number[];
}

/**
 * Das Modell. df: in wie vielen Dokumenten jedes Wort vorkommt; die Restklasse „keiner“ (oder „ohne Tag“) ergibt sich
 * aus df und gesamt minus den Klassen, so steht sie nicht doppelt drin.
 */
export interface Modell {
  version: 1;
  gesamt: number;
  wortschatz: string[];
  df: number[];
  ziele: Record<Ziel, Klasse[]>;
  /** Je Tag die Dokumente mit diesem Tag; ohne Tag ist der Rest */
  tags: Klasse[];
}

function klasseAus(wert: string, docs: number[][]): Klasse {
  const zaehler = new Map<number, number>();
  for (const d of docs) for (const i of d) zaehler.set(i, (zaehler.get(i) ?? 0) + 1);
  const idx = [...zaehler.keys()].sort((a, b) => a - b);
  const n = idx.map((i) => zaehler.get(i)!);
  return { wert, anzahl: docs.length, summe: n.reduce((a, b) => a + b, 0), idx, n };
}

/** Lernt aus Beispielen; null unter der Mindestmenge */
export function lernen(beispiele: Beispiel[]): Modell | null {
  if (beispiele.length < MINDESTMENGE) return null;
  const df = new Map<string, number>();
  for (const b of beispiele) for (const w of b.woerter) df.set(w, (df.get(w) ?? 0) + 1);
  const wortschatz = [...df.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_WORTSCHATZ)
    .map(([w]) => w);
  const index = new Map(wortschatz.map((w, i) => [w, i]));
  const docs = beispiele.map((b) => b.woerter.flatMap((w) => (index.has(w) ? [index.get(w)!] : [])));
  const gruppieren = (wertVon: (b: Beispiel) => string | null) => {
    const je = new Map<string, number[][]>();
    beispiele.forEach((b, i) => {
      const w = wertVon(b);
      if (w === null) return;
      const liste = je.get(w) ?? [];
      liste.push(docs[i]!);
      je.set(w, liste);
    });
    return [...je.entries()]
      .filter(([, d]) => d.length >= MIN_JE_KLASSE)
      .map(([w, d]) => klasseAus(w, d))
      .sort((a, b) => (a.wert < b.wert ? -1 : 1));
  };
  const alleTags = [...new Set(beispiele.flatMap((b) => b.tags))];
  return {
    version: 1,
    gesamt: beispiele.length,
    wortschatz,
    df: wortschatz.map((w) => df.get(w)!),
    ziele: {
      art: gruppieren((b) => b.art),
      korrespondent: gruppieren((b) => b.korrespondent),
      dokumenttyp: gruppieren((b) => b.dokumenttyp),
    },
    // Ein Tag braucht Beispiele mit und ohne ihn
    tags: alleTags
      .map((t) => {
        const mit = beispiele.flatMap((b, i) => (b.tags.includes(t) ? [docs[i]!] : []));
        return mit.length >= MIN_JE_KLASSE && beispiele.length - mit.length >= MIN_JE_KLASSE ? klasseAus(t, mit) : null;
      })
      .filter((k): k is Klasse => k !== null)
      .sort((a, b) => (a.wert < b.wert ? -1 : 1)),
  };
}

export interface Treffer {
  wert: string;
  /** Sicherheit zwischen 0 und 1 */
  sicherheit: number;
  /** Aus so vielen Dokumenten dieser Klasse gelernt */
  anzahl: number;
  /** Wörter des Dokuments, die am meisten für die Klasse sprechen */
  woerter: string[];
}

export interface Vorhersage {
  art: Treffer | null;
  korrespondent: Treffer | null;
  dokumenttyp: Treffer | null;
  tags: Treffer[];
}

/** Zählung einer Klasse als dichte Abbildung Index → Zahl der Dokumente */
const zaehlung = (k: Pick<Klasse, "idx" | "n">) => new Map(k.idx.map((i, j) => [i, k.n[j]!]));

interface Kandidat {
  wert: string | null;
  anzahl: number;
  summe: number;
  woerter: Map<number, number>;
}

/** Restklasse: alle Dokumente, die in keiner der Klassen sind */
function rest(m: Modell, klassen: Klasse[], zaehlungen: Map<number, number>[]): Kandidat {
  const woerter = new Map<number, number>();
  let summe = 0;
  m.df.forEach((df, i) => {
    const n = df - zaehlungen.reduce((s, z) => s + (z.get(i) ?? 0), 0);
    if (n > 0) {
      woerter.set(i, n);
      summe += n;
    }
  });
  return { wert: null, anzahl: m.gesamt - klassen.reduce((s, k) => s + k.anzahl, 0), summe, woerter };
}

/** Wahrscheinlichkeiten der Kandidaten für ein Dokument (Laplace-Glättung, gedämpft auf WIRKSAME_WOERTER) */
function bewerten(m: Modell, kandidaten: Kandidat[], doc: number[]): number[] {
  const v = m.wortschatz.length;
  const daempfung = Math.min(1, WIRKSAME_WOERTER / Math.max(1, doc.length));
  const punkte = kandidaten.map((k) => {
    if (k.anzahl <= 0) return Number.NEGATIVE_INFINITY;
    const nenner = Math.log(k.summe + v);
    let s = 0;
    for (const i of doc) s += Math.log((k.woerter.get(i) ?? 0) + 1) - nenner;
    return Math.log(k.anzahl / m.gesamt) + daempfung * s;
  });
  const hoechste = Math.max(...punkte);
  const exp = punkte.map((p) => Math.exp(p - hoechste));
  const summe = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / summe);
}

/** Wörter des Dokuments, die in der Klasse viel häufiger sind als im Rest (Lift), die stärksten drei */
function gruende(m: Modell, k: Kandidat, doc: number[]): string[] {
  const restAnzahl = m.gesamt - k.anzahl;
  return doc
    .map((i) => {
      const n = k.woerter.get(i) ?? 0;
      const lift = (n + 1) / (k.anzahl + 2) / ((m.df[i]! - n + 1) / (restAnzahl + 2));
      return { w: m.wortschatz[i]!, lift, n };
    })
    .filter((x) => x.n > 0 && x.lift > 1.5)
    .sort((a, b) => b.lift - a.lift || (a.w < b.w ? -1 : 1))
    .slice(0, 3)
    .map((x) => x.w);
}

function besteKlasse(m: Modell, klassen: Klasse[], doc: number[]): Treffer | null {
  if (!klassen.length) return null;
  const zaehlungen = klassen.map(zaehlung);
  const kandidaten: Kandidat[] = [
    ...klassen.map((k, i) => ({ wert: k.wert, anzahl: k.anzahl, summe: k.summe, woerter: zaehlungen[i]! })),
    rest(m, klassen, zaehlungen),
  ];
  const p = bewerten(m, kandidaten, doc);
  const beste = p.indexOf(Math.max(...p));
  const k = kandidaten[beste]!;
  if (k.wert === null || p[beste]! < SCHWELLE) return null;
  return { wert: k.wert, sicherheit: p[beste]!, anzahl: k.anzahl, woerter: gruende(m, k, doc) };
}

/** Was das Modell für die Wörter eines Dokuments vorschlägt; nur Klassen über der Schwelle */
export function vorhersagen(m: Modell, woerter: string[]): Vorhersage {
  const index = new Map(m.wortschatz.map((w, i) => [w, i]));
  const doc = [...new Set(woerter)].flatMap((w) => (index.has(w) ? [index.get(w)!] : []));
  return {
    art: besteKlasse(m, m.ziele.art, doc),
    korrespondent: besteKlasse(m, m.ziele.korrespondent, doc),
    dokumenttyp: besteKlasse(m, m.ziele.dokumenttyp, doc),
    tags: m.tags.flatMap((t) => besteKlasse(m, [t], doc) ?? []),
  };
}
