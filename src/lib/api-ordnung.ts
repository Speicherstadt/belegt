import type { Farbe, Feldtyp, Feldwert } from "../../shared/ordnung.ts";
import type { Art } from "./api.ts";

/* Typen der Schnittstelle für Tags, Dokumenttypen, eigene Felder und die Sammelbearbeitung (docs/api.md) */

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
