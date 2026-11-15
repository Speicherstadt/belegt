import { aufruf, json } from "./api-aufruf.ts";

/* Umzug aus Paperless-ngx: Quellen mit API-Token, Upload eines Exports, Läufe und Zuordnungen (docs/umzug.md) */

export interface PaperlessQuelle {
  id: string;
  name: string;
  url: string;
  erstelltAm: string;
}

export type ImportStatus = "wartet" | "laeuft" | "fertig" | "abgebrochen" | "fehler";

export interface ImportLauf {
  id: string;
  art: "api" | "export";
  quelleId: string | null;
  quelle: string | null;
  dateiname: string | null;
  status: ImportStatus;
  gesamt: number | null;
  uebernommen: number;
  doppelt: number;
  fehler: number;
  meldung: string | null;
  hinweise: string[];
  abbrechen: boolean;
  erstelltAm: string;
  beendetAm: string | null;
}

export type ZielArt = "buecher" | "zoll" | "beleg" | "geschaeftsbrief" | "sonstige" | "frei";

export interface ImportZuordnung {
  id: string;
  art: "dokumenttyp" | "tag";
  name: string;
  zielArt: ZielArt;
}

export const paperlessApi = {
  paperlessQuellen: () => aufruf<PaperlessQuelle[]>("/api/paperless/quellen"),
  paperlessQuelleAnlegen: (q: { name: string; url: string; token: string }) =>
    aufruf<PaperlessQuelle>("/api/paperless/quellen", json(q)),
  paperlessStarten: (id: string) => aufruf<ImportLauf>(`/api/paperless/quellen/${id}/starten`, { method: "POST" }),
  paperlessExport: (datei: File) =>
    aufruf<ImportLauf>(`/api/paperless/export?name=${encodeURIComponent(datei.name)}`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: datei,
    }),
  importe: () => aufruf<ImportLauf[]>("/api/paperless/importe"),
  importFehler: (id: string) =>
    aufruf<{ paperlessId: number; titel: string | null; grund: string }[]>(`/api/paperless/importe/${id}/fehler`),
  importAbbrechen: (id: string) => aufruf<{ ok: true }>(`/api/paperless/importe/${id}/abbrechen`, { method: "POST" }),
  zuordnungen: () => aufruf<ImportZuordnung[]>("/api/paperless/zuordnungen"),
  zuordnungAnlegen: (z: Omit<ImportZuordnung, "id">) => aufruf<ImportZuordnung>("/api/paperless/zuordnungen", json(z)),
  zuordnungLoeschen: (id: string) => aufruf<{ ok: true }>(`/api/paperless/zuordnungen/${id}`, { method: "DELETE" }),
};
