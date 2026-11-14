/*
 * Ordnung neben der GoBD-Art: Tags, Dokumenttypen und eigene Felder. Sie sind Metadaten, nicht das Original; sie
 * lassen sich ändern, und jede Änderung steht im Audit-Log. Die Frist bestimmt allein die Art der Einordnung.
 */

/**
 * Feste Farben für Tags: Hintergrund und Schrift sind fest (unabhängig von hell und dunkel), damit der Kontrast in
 * beiden Darstellungen derselbe ist. ordnung.test.ts prüft, dass jede Farbe WCAG 2.2 AA (4,5:1) erreicht.
 */
export const FARBEN = {
  grau: { hintergrund: "#e4e4e7", schrift: "#18181b" },
  rot: { hintergrund: "#fecaca", schrift: "#7f1d1d" },
  orange: { hintergrund: "#fed7aa", schrift: "#7c2d12" },
  gelb: { hintergrund: "#fef08a", schrift: "#713f12" },
  gruen: { hintergrund: "#bbf7d0", schrift: "#14532d" },
  tuerkis: { hintergrund: "#99f6e4", schrift: "#134e4a" },
  blau: { hintergrund: "#bfdbfe", schrift: "#1e3a8a" },
  violett: { hintergrund: "#ddd6fe", schrift: "#4c1d95" },
  rosa: { hintergrund: "#fbcfe8", schrift: "#831843" },
} as const;
export type Farbe = keyof typeof FARBEN;
export const FARBNAMEN = Object.keys(FARBEN) as Farbe[];

/** Relative Leuchtdichte nach WCAG 2.2 (1.4.3) einer Farbe #rrggbb */
function leuchtdichte(hex: string): number {
  const kanal = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(0) + 0.7152 * kanal(1) + 0.0722 * kanal(2);
}

/** Kontrastverhältnis zweier Farben nach WCAG, 1 bis 21 */
export function kontrast(a: string, b: string): number {
  const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x) as [number, number];
  return (hell + 0.05) / (dunkel + 0.05);
}

export const FELDTYPEN = ["text", "zahl", "betrag", "datum", "ja_nein", "auswahl", "link"] as const;
export type Feldtyp = (typeof FELDTYPEN)[number];

/** Größter Betrag in Cent (zehn Billionen Euro) und größte Zahl; bleibt unter Number.MAX_SAFE_INTEGER */
export const GRENZE = 1_000_000_000_000_000;

/**
 * Betrag in deutscher Schreibweise („1.234,56“, „-12,5“, „1234“, auch mit „€“) als ganze Cent; null, wenn der Text
 * kein Betrag ist. Tausenderpunkte nur in Dreiergruppen, höchstens zwei Nachkommastellen. Gerechnet wird nur mit
 * ganzen Zahlen aus den Ziffern, nie mit einer Fließkommazahl.
 */
export function betragAusText(text: string): number | null {
  const t = text.trim().replace(/\s*(€|EUR)$/i, "");
  const treffer = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!treffer) return null;
  const [, minus, euro, cent = ""] = treffer;
  const ziffern = `${euro!.replace(/\./g, "")}${cent.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  if (ziffern.length > String(GRENZE).length) return null;
  const wert = Number(ziffern);
  if (wert > GRENZE) return null;
  return minus && wert !== 0 ? -wert : wert;
}

/** Cent als „1234,56“ für Eingabefelder und den Datenträger: ohne Tausenderpunkte, mit Komma */
export function betragAlsText(cent: number): string {
  const abs = Math.abs(cent);
  return `${cent < 0 ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Wert eines eigenen Feldes, wie ihn die Schnittstelle liefert: Cent bei betrag, JJJJ-MM-TT bei datum */
export type Feldwert = string | number | boolean;
