import { aufruf, json } from "./api-aufruf.ts";
import type { Art } from "./api-dokumente.ts";

/* Workflows: Auslöser, Bedingungen, Aktionen und ihre Läufe (docs/workflows.md) */

export type Ausloeser = "eingang" | "eingeordnet";
export type WorkflowQuelle = "upload" | "mail" | "ordner" | "api" | "abgeleitet" | "import";

export interface WorkflowBedingungen {
  quellen?: WorkflowQuelle[];
  dateinameEnthaelt?: string;
  betreffEnthaelt?: string;
  absender?: string;
  domain?: string;
  anhangTyp?: string;
  textEnthaelt?: string;
  mimeTyp?: string;
  tags?: string[];
  dokumenttyp?: string;
  /** ID eines Korrespondenten oder „ohne“ */
  korrespondent?: string;
  postfach?: string;
  unterordner?: string;
}

export type WorkflowAktion =
  | { art: "tagsHinzu"; tags: string[] }
  | { art: "tagsWeg"; tags: string[] }
  | { art: "dokumenttyp"; dokumenttyp: string }
  | { art: "korrespondent"; korrespondent: string }
  | { art: "feld"; feldId: string; wert: unknown }
  | {
      art: "einordnen";
      als: Art;
      entstanden: "eingang" | "erechnung";
      freiwilligBis?: string;
      titel?: string;
      ausdruecklich: true;
    }
  | { art: "webhook" }
  | { art: "notiz"; text: string };

export interface Workflow {
  id: string;
  name: string;
  reihenfolge: number;
  aktiv: boolean;
  ausloeser: Ausloeser;
  bedingungen: WorkflowBedingungen;
  aktionen: WorkflowAktion[];
  anhalten: boolean;
  erstelltAm: string;
}

export interface WorkflowLauf {
  id: string;
  workflowName: string;
  dokumentId: string;
  asn: number;
  dateiname: string | null;
  ergebnis: "ausgefuehrt" | "trifft_nicht" | "angehalten" | "fehler";
  fehler: string | null;
  zeitpunkt: string;
}

export const workflowsApi = {
  workflows: () => aufruf<Workflow[]>("/api/workflows"),
  workflowAnlegen: (w: Omit<Workflow, "id" | "reihenfolge" | "aktiv" | "erstelltAm">) =>
    aufruf<Workflow>("/api/workflows", json(w)),
  workflowSchalten: (id: string, aktiv: boolean) =>
    aufruf<Workflow>(`/api/workflows/${id}/${aktiv ? "aktivieren" : "deaktivieren"}`, { method: "POST" }),
  workflowLoeschen: (id: string) => aufruf<unknown>(`/api/workflows/${id}`, { method: "DELETE" }),
  workflowsOrdnen: (ids: string[]) => aufruf<unknown>("/api/workflows/reihenfolge", json({ ids })),
  workflowLaeufe: () => aufruf<WorkflowLauf[]>("/api/workflows/laeufe"),
};
