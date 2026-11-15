import type { Feldwert } from "../../shared/ordnung.ts";
import { aufruf, json } from "./api-aufruf.ts";
import type { Art } from "./api-dokumente.ts";
import type { OrdnungsVorschlag } from "./api-ordnung.ts";

/* Quellen, Regeln, Webhooks, Sperren und Fristen, Prüfung, Zeitstempel, Angaben zum Betrieb (docs/api.md) */

export interface Regel {
  id: string;
  name: string;
  reihenfolge: number;
  bedingung: { absender?: string; domain?: string; betreffEnthaelt?: string; anhangTyp?: string };
  /** null: die Regel schlägt nur Tags, Dokumenttyp oder Feldwerte vor */
  art: Art | null;
  aktiv: boolean;
  ordnung: OrdnungsVorschlag | null;
}

export interface Quelle {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  benutzer: string;
  ordner: string;
  art: "imap" | "jmap";
  oauth: "microsoft" | "google" | null;
  letzteUid: number;
  letzterAbruf: string | null;
  letzterFehler: string | null;
  aktiv: boolean;
}

export const EREIGNISSE = ["dokument.aufgenommen", "dokument.eingeordnet", "dokument.geloescht"] as const;
export type Ereignisart = (typeof EREIGNISSE)[number];

export interface Webhook {
  id: string;
  name: string;
  url: string;
  arten: Ereignisart[];
  aktiv: boolean;
  letzteZustellung: string | null;
  letzterFehler: string | null;
}

export interface Sperre {
  id: string;
  grund: string;
  von: string;
  bis: string;
  angelegtAm: string;
  aufgehobenAm: string | null;
}

export interface Uebersicht {
  gesamt: number;
  offen: number;
  jeArt: Record<string, number>;
  gesperrt: number;
  loeschbar: number;
}

export interface Befund {
  art: string;
  tabelle: string;
  zeile: string | null;
  seq: number | null;
  befund: string;
}

export interface Bericht {
  zeitpunkt: string;
  pruefwert: string | null;
  dokumente: number;
  geloescht: number;
  siegel: number;
  protokoll: number;
  zeitstempel: { seq: number; zeit: string; dienst: string } | null;
}

export interface Einstellungen {
  firma: string;
  anschrift: string;
  verantwortlich: string;
  aufsicht: boolean;
  datensicherung: string;
  scannen: string;
  ergaenzungen: string;
}

export interface Verfahrensdoku {
  stand: string;
  vollstaendig: boolean;
  abschnitte: { titel: string; absaetze: string[]; liste?: string[]; luecken?: string[] }[];
}

export const betriebApi = {
  regeln: () => aufruf<Regel[]>("/api/regeln"),
  regelAnlegen: (r: {
    name: string;
    wenn: Regel["bedingung"];
    dann: Art | null;
    ordnung?: { tags: string[]; dokumenttyp: string | null; felder: { feldId: string; wert: Feldwert }[] };
  }) => aufruf<Regel>("/api/regeln", json(r)),
  regelSchalten: (id: string, aktiv: boolean) =>
    aufruf<Regel>(`/api/regeln/${id}/${aktiv ? "aktivieren" : "deaktivieren"}`, { method: "POST" }),
  quellen: () => aufruf<Quelle[]>("/api/quellen"),
  quelleAnlegen: (q: {
    name: string;
    host: string;
    port: number;
    tls: boolean;
    benutzer: string;
    passwort: string;
    ordner: string;
    art: "imap" | "jmap";
  }) => aufruf<Quelle>("/api/quellen", json(q)),
  quelleAbrufen: (id: string) =>
    aufruf<{ neu: number; doppelt: number; fehler: string | null }>(`/api/quellen/${id}/abrufen`, { method: "POST" }),
  oauthAnbieter: () => aufruf<{ anbieter: ("microsoft" | "google")[] }>("/api/oauth"),
  webhooks: () => aufruf<Webhook[]>("/api/webhooks"),
  webhookAnlegen: (w: { name: string; url: string; arten: Ereignisart[] }) =>
    aufruf<Webhook & { geheimnis: string }>("/api/webhooks", json(w)),
  webhookSchalten: (id: string, aktiv: boolean) =>
    aufruf<Webhook>(`/api/webhooks/${id}/${aktiv ? "aktivieren" : "deaktivieren"}`, { method: "POST" }),
  einstellungen: () => aufruf<Einstellungen>("/api/einstellungen"),
  einstellungenSpeichern: (e: Einstellungen) => aufruf<Einstellungen>("/api/einstellungen", json(e)),
  verfahrensdoku: () => aufruf<Verfahrensdoku>("/api/verfahrensdoku"),
  sperren: () => aufruf<Sperre[]>("/api/sperren"),
  sperreAnlegen: (eingabe: { grund: string; von: string; bis: string }) =>
    aufruf<Sperre>("/api/sperren", json(eingabe)),
  sperreAufheben: (id: string) => aufruf<Sperre>(`/api/sperren/${id}/aufheben`, { method: "POST" }),
  uebersicht: () => aufruf<Uebersicht>("/api/fristen/uebersicht"),
  pruefung: (dateien = false) =>
    aufruf<{ ok: boolean; befunde: Befund[]; dateienGeprueft?: number; bericht: Bericht }>(
      `/api/pruefung${dateien ? "?dateien=1" : ""}`,
    ),
  zeitstempel: () =>
    aufruf<{ id: string; seq: number; hash: string; dienst: string; zeit: string; seriennummer: string }[]>(
      "/api/zeitstempel",
    ),
};
