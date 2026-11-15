import { aufruf, json } from "./api-aufruf.ts";

/* Gespeicherte Ansichten des Archivs (docs/api.md) */

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

export const alltagApi = {
  ansichten: () => aufruf<GespeicherteAnsicht[]>("/api/ansichten"),
  ansichtAnlegen: (a: { name: string; parameter: Record<string, string>; fuerAlle: boolean }) =>
    aufruf<GespeicherteAnsicht>("/api/ansichten", json(a)),
  ansichtAendern: (id: string, a: { name?: string; parameter?: Record<string, string>; fuerAlle?: boolean }) =>
    aufruf<GespeicherteAnsicht>(`/api/ansichten/${id}`, { ...json(a), method: "PATCH" }),
  ansichtLoeschen: (id: string) => aufruf<unknown>(`/api/ansichten/${id}`, { method: "DELETE" }),
  ansichtenOrdnen: (ids: string[]) => aufruf<unknown>("/api/ansichten/reihenfolge", json({ ids })),
};
