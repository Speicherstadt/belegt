/*
 * Blättern auf der Dokumentseite: Die Liste, aus der man kommt (Archiv oder Eingang), merkt sich die Reihenfolge der
 * gezeigten Dokumente im sessionStorage. Nur eine Bequemlichkeit je Tab; fehlt sie, gibt es eben kein Weiter.
 */

const SCHLUESSEL = "belegt.blaettern";

export interface Blaetterliste {
  ids: string[];
  /** Wohin „Zurück“ führt, etwa /eingang oder /archiv?tags=… */
  zurueck: string;
}

export function listeMerken(liste: Blaetterliste) {
  try {
    sessionStorage.setItem(SCHLUESSEL, JSON.stringify(liste));
  } catch {
    // Ohne Speicher kein Blättern, sonst nichts
  }
}

export function listeLesen(): Blaetterliste | null {
  try {
    const roh = JSON.parse(sessionStorage.getItem(SCHLUESSEL) ?? "null");
    return roh && Array.isArray(roh.ids) && typeof roh.zurueck === "string" ? roh : null;
  } catch {
    return null;
  }
}

/** Vorheriges und nächstes Dokument zu einer ID; null am Rand oder wenn sie nicht in der Liste steht */
export function nachbarn(liste: Blaetterliste | null, id: string) {
  const i = liste ? liste.ids.indexOf(id) : -1;
  if (!liste || i < 0) return { vorher: null, weiter: null, stelle: 0, anzahl: 0 };
  return {
    vorher: liste.ids[i - 1] ?? null,
    weiter: liste.ids[i + 1] ?? null,
    stelle: i + 1,
    anzahl: liste.ids.length,
  };
}
