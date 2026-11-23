import type { Eintrag, Gruppe } from "../lib/api.ts";

/*
 * Die aufgenommenen Antworten des Servers für die Demo (e2e/demo-aufnahme.ts schreibt sie nach demo/aufnahme.json):
 * je Anfrage JSON oder eine Datei unter demo/dateien/, dazu die Listen der Dokumente je Gruppe.
 */

export const GRUPPEN: readonly Gruppe[] = [
  "alle",
  "offen",
  "pflicht",
  "freiwillig",
  "frei",
  "loeschbar",
  "geloescht",
  "erechnung_ungueltig",
];

export type Aufgenommen = { status: number; json: unknown } | { status: number; typ: string; datei: string };

export interface Aufnahme {
  /** Zeitpunkt der Aufnahme */
  stand: string;
  listen: Partial<Record<Gruppe, Eintrag[]>>;
  antworten: Record<string, Aufgenommen>;
}

/** Pfad und Suchparameter in fester Reihenfolge, damit dieselbe Anfrage denselben Schlüssel ergibt */
export function schluessel(pfad: string, suche: string): string {
  const p = new URLSearchParams(suche);
  p.sort();
  const text = p.toString();
  return text ? `${pfad}?${text}` : pfad;
}
