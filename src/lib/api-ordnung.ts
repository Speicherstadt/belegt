import type { Farbe, Feldtyp, Feldwert } from "../../shared/ordnung.ts";
import { ApiFehler, aufruf, json } from "./api-aufruf.ts";
import type { Art } from "./api-dokumente.ts";

/* Tags, Dokumenttypen, eigene Felder und die Sammelbearbeitung (docs/api.md) */

export interface TagKurz {
  id: string;
  name: string;
  farbe: Farbe;
}

export interface Tag extends TagKurz {
  anzahl: number;
}

export interface Dokumenttyp {
  id: string;
  name: string;
  vorgabeArt: Art | null;
  anzahl: number;
}

export interface Feld {
  id: string;
  name: string;
  typ: Feldtyp;
  optionen: string[];
}

/** Tags, Dokumenttyp und Feldwerte eines Dokuments */
export interface Ordnung {
  tags: TagKurz[];
  dokumenttyp: { id: string; name: string; vorgabeArt: Art | null } | null;
  felder: { feldId: string; name: string; typ: Feldtyp; wert: Feldwert }[];
}

/** Änderung an Tags, Dokumenttyp und Feldwerten (POST /api/dokumente/:id/ordnung) */
export interface OrdnungAenderung {
  tagsHinzu?: string[];
  tagsWeg?: string[];
  dokumenttyp?: string | null;
  felder?: { feldId: string; wert: Feldwert | null }[];
}

/** Einordnung in der Sammelbearbeitung; entstanden „eingang“ nimmt den Tag des Eingangs jedes Dokuments */
export interface SammelEinordnung {
  art: Art;
  entstanden: string;
  freiwilligBis?: string;
  titel?: string;
  korrespondent?: string;
  nurOffene: boolean;
}

export type SammelErgebnis = { id: string; ok: true; eingeordnet: boolean } | { id: string; ok: false; fehler: string };

/** Filter der Archivliste nach Tags, Dokumenttyp und einem Feld (server/ordnung/filter.ts) */
export interface ListenFilter {
  tags: string[];
  /** „alle“: jedes gewählte Tag; „einer“: mindestens eines */
  tagModus: "alle" | "einer";
  dokumenttyp: string;
  feld: { feldId: string; art: "gesetzt" | "enthaelt" | "bereich"; text: string; von: string; bis: string } | null;
}

/** Vorschlag für Tags, Dokumenttyp und Feldwerte aus einer Regel oder vom Sprachmodell, mit Namen */
export interface OrdnungsVorschlag {
  tags: TagKurz[];
  dokumenttyp: { id: string; name: string } | null;
  felder: { feldId: string; name: string; typ: Feldtyp; wert: Feldwert }[];
}

export const ordnungApi = {
  ordnen: (id: string, aenderung: OrdnungAenderung) => aufruf<Ordnung>(`/api/dokumente/${id}/ordnung`, json(aenderung)),
  /** Sammelbearbeitung: alles oder nichts; 409 kommt mit dem Ergebnis je Dokument zurück, nicht als Fehler */
  sammeln: async (ids: string[], aenderung: OrdnungAenderung & { einordnung?: SammelEinordnung }) => {
    try {
      return await aufruf<{ ok: boolean; ergebnisse: SammelErgebnis[] }>(
        "/api/dokumente/sammeln",
        json({ ids, ...aenderung }),
      );
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 409 && err.ergebnis) return err.ergebnis;
      throw err;
    }
  },
  tags: () => aufruf<Tag[]>("/api/tags"),
  tagAnlegen: (t: { name: string; farbe: Farbe }) => aufruf<Tag>("/api/tags", json(t)),
  tagAendern: (id: string, t: { name?: string; farbe?: Farbe }) =>
    aufruf<Tag>(`/api/tags/${id}`, { ...json(t), method: "PATCH" }),
  tagLoeschen: (id: string) => aufruf<unknown>(`/api/tags/${id}`, { method: "DELETE" }),
  dokumenttypen: () => aufruf<Dokumenttyp[]>("/api/dokumenttypen"),
  dokumenttypAnlegen: (t: { name: string; vorgabeArt: Art | null }) =>
    aufruf<Dokumenttyp>("/api/dokumenttypen", json(t)),
  dokumenttypAendern: (id: string, t: { name?: string; vorgabeArt?: Art | null }) =>
    aufruf<Dokumenttyp>(`/api/dokumenttypen/${id}`, { ...json(t), method: "PATCH" }),
  dokumenttypLoeschen: (id: string) => aufruf<unknown>(`/api/dokumenttypen/${id}`, { method: "DELETE" }),
  felder: () => aufruf<Feld[]>("/api/felder"),
  feldAnlegen: (f: { name: string; typ: Feldtyp; optionen: string[] }) => aufruf<Feld>("/api/felder", json(f)),
  feldAendern: (id: string, f: { name?: string; optionen?: string[] }) =>
    aufruf<Feld>(`/api/felder/${id}`, { ...json(f), method: "PATCH" }),
  feldLoeschen: (id: string) => aufruf<unknown>(`/api/felder/${id}`, { method: "DELETE" }),
};
