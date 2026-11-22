import { aufruf, json } from "./api-aufruf.ts";

/* Gespeicherte Ansichten des Archivs und die Startseite (docs/api.md) */

export interface GespeicherteAnsicht {
  id: string;
  name: string;
  /** Suchparameter der Archivliste (shared/archivansicht.ts) */
  parameter: Record<string, string>;
  fuerAlle: boolean;
  reihenfolge: number;
  /** Eigene Ansicht, die sich ändern lässt */
  eigene: boolean;
}

/** Zahlen der Startseite; ohne die optionalen Teile für den Prüfer (server/start/start.ts) */
export interface Start {
  eingang: number;
  gesamt: number;
  diesesJahr: number;
  /** Im Vorjahr bis zum selben Tag */
  vorjahr: number;
  /** Eingänge je Monat der letzten zwölf Monate, der laufende zuletzt */
  verlauf: number[];
  fristen?: {
    anzahl: number;
    naechste: { id: string; asn: number; titel: string | null; dateiname: string | null; fristBis: string }[];
  };
  loeschantraege?: number;
  sperren?: { aktiv: number; dokumente: number };
  quellen?: {
    postfaecher: {
      id: string;
      name: string;
      art: string;
      aktiv: boolean;
      letzterAbruf: string | null;
      letzterFehler: string | null;
    }[];
    ordner: { letzterEingang: string | null } | null;
    paperless: { status: string; fehler: number; uebernommen: number; zeitpunkt: string } | null;
  };
  speicher?: { bytes: number; dateien: number; datentraeger?: { gesamt: number; frei: number } };
}

export const alltagApi = {
  start: () => aufruf<Start>("/api/start"),
  startKacheln: () => aufruf<{ ansichten: string[] }>("/api/start/kacheln"),
  startKachelnSetzen: (ansichten: string[]) =>
    aufruf<{ ansichten: string[] }>("/api/start/kacheln", { ...json({ ansichten }), method: "PUT" }),
  ansichten: () => aufruf<GespeicherteAnsicht[]>("/api/ansichten"),
  ansichtAnlegen: (a: { name: string; parameter: Record<string, string>; fuerAlle: boolean }) =>
    aufruf<GespeicherteAnsicht>("/api/ansichten", json(a)),
  ansichtAendern: (id: string, a: { name?: string; parameter?: Record<string, string>; fuerAlle?: boolean }) =>
    aufruf<GespeicherteAnsicht>(`/api/ansichten/${id}`, { ...json(a), method: "PATCH" }),
  ansichtLoeschen: (id: string) => aufruf<unknown>(`/api/ansichten/${id}`, { method: "DELETE" }),
  ansichtenOrdnen: (ids: string[]) => aufruf<unknown>("/api/ansichten/reihenfolge", json({ ids })),
};
