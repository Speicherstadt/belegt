/*
 * Aufbewahrungsfristen nach § 147 AO (Fassung ab 1. Januar 2025):
 * https://www.gesetze-im-internet.de/ao_1977/__147.html
 *
 * - Abs. 3 Satz 1: Unterlagen nach Abs. 1 Nr. 1 (Bücher, Aufzeichnungen, Inventare, Jahresabschlüsse, Lageberichte,
 *   Eröffnungsbilanz, Arbeitsanweisungen und Organisationsunterlagen) und Nr. 4a (Zoll) zehn Jahre, Nr. 4
 *   (Buchungsbelege) acht Jahre, die übrigen (Nr. 2 und 3 Handels- und Geschäftsbriefe, Nr. 5 sonstige Unterlagen)
 *   sechs Jahre.
 * - Abs. 4: Die Frist beginnt mit dem Schluss des Kalenderjahres, in dem die Unterlage entstanden, empfangen oder
 *   abgesandt worden ist.
 * - Abs. 3 Satz 5: Die Frist läuft nicht ab, soweit und solange die Unterlagen für Steuern von Bedeutung sind, deren
 *   Festsetzungsfrist noch nicht abgelaufen ist. Das kann Belegt nicht wissen: Das Fristende hier ist der früheste
 *   Tag, an dem eine Löschung in Frage kommt; gelöscht wird nur nach Bestätigung durch einen Menschen.
 *
 * Übergang (Art. 97 § 19a EGAO, https://www.gesetze-im-internet.de/aoeg_1977/art_97__19a.html): Die acht Jahre
 * gelten für alle Unterlagen, deren Frist am 31. Dezember 2024 noch nicht abgelaufen war (Abs. 2). Ältere Belege
 * waren nach zehn Jahren ohnehin abgelaufen; acht Jahre ergeben für alle übrigen dasselbe wie die Regel. Kredit- und
 * Wertpapierinstitute und Unternehmen unter Versicherungsaufsicht behalten zehn Jahre (Abs. 3).
 *
 * Nicht abgebildet: Lieferscheine, die keine Buchungsbelege sind (Abs. 3 Satz 3 und 4), und kürzere Fristen aus
 * anderen Steuergesetzen.
 */

/** Was eine Unterlage ist; bestimmt die Frist */
export type Aufbewahrungsart =
  /** § 147 Abs. 1 Nr. 1 AO */
  | "buecher"
  /** § 147 Abs. 1 Nr. 4a AO */
  | "zoll"
  /** § 147 Abs. 1 Nr. 4 AO */
  | "beleg"
  /** § 147 Abs. 1 Nr. 2 und 3 AO */
  | "geschaeftsbrief"
  /** § 147 Abs. 1 Nr. 5 AO */
  | "sonstige"
  /** keine Pflicht; gesperrt bis zu einem selbst gewählten Tag */
  | "freiwillig"
  /** keine Pflicht und keine Sperre: jederzeit löschbar */
  | "frei";

/** Alle Arten, in der Reihenfolge, in der die Schnittstelle sie annimmt */
export const ARTEN = [
  "buecher",
  "zoll",
  "beleg",
  "geschaeftsbrief",
  "sonstige",
  "freiwillig",
  "frei",
] as const satisfies readonly Aufbewahrungsart[];

export interface Steuerpflichtiger {
  /** Kredit- oder Wertpapierinstitut oder unter Versicherungsaufsicht (Art. 97 § 19a Abs. 3 EGAO) */
  aufsicht?: boolean;
}

/** Jahre nach § 147 Abs. 3 AO; null, wenn keine gesetzliche Frist gilt */
export function gesetzlicheJahre(art: Aufbewahrungsart, wer: Steuerpflichtiger = {}): number | null {
  switch (art) {
    case "buecher":
    case "zoll":
      return 10;
    case "beleg":
      return wer.aufsicht ? 10 : 8;
    case "geschaeftsbrief":
    case "sonstige":
      return 6;
    case "freiwillig":
    case "frei":
      return null;
  }
}

const ISO_DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

function jahrVon(datum: string): number {
  const treffer = ISO_DATUM.exec(datum);
  if (!treffer) throw new Error(`Kein Datum im Format JJJJ-MM-TT: ${datum}`);
  const [jahr, monat, tag] = [Number(treffer[1]), Number(treffer[2]), Number(treffer[3])];
  // Date rechnet einen 30. Februar in den März um; stimmt der Tag danach nicht mehr, gibt es ihn nicht
  const probe = new Date(Date.UTC(jahr, monat - 1, tag));
  if (probe.getUTCMonth() !== monat - 1 || probe.getUTCDate() !== tag)
    throw new Error(`Den Tag ${datum} gibt es nicht`);
  return jahr;
}

export interface Frist {
  /** Letzter Tag der Aufbewahrung (JJJJ-MM-TT); null: keine Sperre */
  bis: string | null;
  /** Gesetzliche Frist (Hinweis auf die Ablaufhemmung nach § 147 Abs. 3 Satz 5 AO nötig) oder selbst gewählt */
  grund: "gesetz" | "freiwillig" | "keine";
}

/**
 * Fristende einer Unterlage. `entstanden` ist der Tag, an dem sie entstanden, empfangen oder abgesandt wurde
 * (§ 147 Abs. 4 AO), bei Büchern der Tag der letzten Eintragung. Bei freiwilliger Aufbewahrung gilt `freiwilligBis`.
 */
export function fristende(
  art: Aufbewahrungsart,
  entstanden: string,
  optionen: Steuerpflichtiger & { freiwilligBis?: string } = {},
): Frist {
  const jahr = jahrVon(entstanden);
  if (art === "frei") return { bis: null, grund: "keine" };
  if (art === "freiwillig") {
    if (!optionen.freiwilligBis) throw new Error("Freiwillige Aufbewahrung braucht ein Datum, bis wann");
    jahrVon(optionen.freiwilligBis);
    if (optionen.freiwilligBis < entstanden) throw new Error("Das Datum liegt vor der Entstehung der Unterlage");
    return { bis: optionen.freiwilligBis, grund: "freiwillig" };
  }
  const jahre = gesetzlicheJahre(art, optionen)!;
  return { bis: `${jahr + jahre}-12-31`, grund: "gesetz" };
}

/** Ob eine Löschung am Tag `heute` in Frage kommt: erst nach dem letzten Tag der Frist */
export function loeschbar(frist: Frist, heute: string): boolean {
  jahrVon(heute);
  return frist.bis === null || heute > frist.bis;
}
