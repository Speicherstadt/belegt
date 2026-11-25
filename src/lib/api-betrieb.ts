import type { AngabenZumBetrieb, Verfahrensdoku } from "@firsttris/gobd-kern/verfahrensdoku";
import type { Feldwert } from "../../shared/ordnung.ts";
import { antwort, aufruf, json } from "./api-aufruf.ts";
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
  aktion: PostfachAktion;
  /** Zielordner: bei IMAP der Pfad, bei JMAP die Mailbox-ID */
  aktionZiel: string | null;
  aktionZielPfad: string | null;
  /** Der Zielordner ist ein Papierkorb: Verschieben gilt wie Löschen */
  aktionZielPapierkorb: boolean;
  loeschenWarteStunden: number;
  loeschenNachSperre: boolean;
  loeschenBestaetigtVon: string | null;
  loeschenBestaetigtAm: string | null;
}

/** Ordner eines Postfachs: id ist bei IMAP der Pfad, bei JMAP die Mailbox-ID */
export interface PostfachOrdner {
  id: string;
  pfad: string;
  papierkorb: boolean;
}

/** Aktion im Postfach nach dem Abholen (docs/eingang.md#nach-dem-abholen) */
export type PostfachAktion = "keine" | "gelesen" | "markieren" | "verschieben" | "loeschen";

export interface AktionEingabe {
  aktion: PostfachAktion;
  ziel: string | null;
  warteStunden: number;
  nachSperre: boolean;
  loeschenBestaetigt: boolean;
}

export interface AktionenProtokoll {
  stand: { offen: number; erledigt: number; entfallen: number; fehlgeschlagen: number };
  eintraege: {
    id: string;
    aktion: PostfachAktion;
    ziel: string | null;
    ordner: string;
    uid: number | null;
    jmapId: string | null;
    ergebnis: "ausgefuehrt" | "entfallen" | "fehler";
    meldung: string | null;
    zeit: string;
  }[];
  /** Dateien liegen in S3 mit Object Lock: „erst nach Sperre“ ist möglich */
  objektsperre: boolean;
}

export const EREIGNISSE = [
  "dokument.aufgenommen",
  "dokument.eingeordnet",
  "dokument.geloescht",
  "dokument.workflow",
] as const;
export type Ereignisart = (typeof EREIGNISSE)[number];

/** Nur die geänderten Felder; `passwort` nur, wenn es neu gesetzt wird (leer = bleibt) */
export type QuelleAenderung = Partial<
  Pick<Quelle, "name" | "host" | "port" | "tls" | "benutzer" | "ordner"> & { passwort: string }
>;

export interface Webhook {
  id: string;
  name: string;
  url: string;
  arten: Ereignisart[];
  aktiv: boolean;
  letzteZustellung: string | null;
  letzterFehler: string | null;
}

export type WebhookAenderung = Partial<Pick<Webhook, "name" | "url" | "arten">>;

/** Eigene Fristvorlage: Name und Dauer in Monaten (server/fristvorlagen/) */
export interface Fristvorlage {
  id: string;
  name: string;
  monate: number;
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

/** Ein gespeicherter Lauf der Prüfung von Kette, Kopf und Siegeln (server/pruefung/kette.ts) */
export interface Kettenpruefung {
  geprueftAm: string;
  ok: boolean;
  befunde: number;
  eintraege: number;
  dauerMs: number;
  ausgeloestVon: string;
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

/** Angaben zum Betrieb nach dem Schema des GoBD-Kerns, dazu die Aufsicht, die die Frist für Buchungsbelege verlängert */
export type Einstellungen = AngabenZumBetrieb & { aufsicht: boolean };

export type { Verfahrensdoku };

export const betriebApi = {
  regeln: () => aufruf<Regel[]>("/api/regeln"),
  regelAnlegen: (r: {
    name: string;
    wenn: Regel["bedingung"];
    dann: Art | null;
    ordnung?: {
      tags: string[];
      dokumenttyp: string | null;
      korrespondent?: string | null;
      felder: { feldId: string; wert: Feldwert }[];
    };
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
  quelleAendern: (id: string, e: QuelleAenderung) =>
    aufruf<Quelle>(`/api/quellen/${id}`, { ...json(e), method: "PATCH" }),
  quelleEntfernen: (id: string) => antwort(`/api/quellen/${id}`, { method: "DELETE" }),
  quelleAbrufen: (id: string) =>
    aufruf<{ neu: number; doppelt: number; fehler: string | null }>(`/api/quellen/${id}/abrufen`, { method: "POST" }),
  quelleAktion: ({ id, ...e }: AktionEingabe & { id: string }) => aufruf<Quelle>(`/api/quellen/${id}/aktion`, json(e)),
  quelleOrdner: (id: string) => aufruf<{ ordner: PostfachOrdner[] }>(`/api/quellen/${id}/ordner`),
  quelleAktionen: (id: string) => aufruf<AktionenProtokoll>(`/api/quellen/${id}/aktionen`),
  oauthAnbieter: () => aufruf<{ anbieter: ("microsoft" | "google")[] }>("/api/oauth"),
  webhooks: () => aufruf<Webhook[]>("/api/webhooks"),
  webhookAnlegen: (w: { name: string; url: string; arten: Ereignisart[] }) =>
    aufruf<Webhook & { geheimnis: string }>("/api/webhooks", json(w)),
  webhookAendern: (id: string, w: WebhookAenderung) =>
    aufruf<Webhook>(`/api/webhooks/${id}`, { ...json(w), method: "PATCH" }),
  webhookEntfernen: (id: string) => antwort(`/api/webhooks/${id}`, { method: "DELETE" }),
  webhookSchalten: (id: string, aktiv: boolean) =>
    aufruf<Webhook>(`/api/webhooks/${id}/${aktiv ? "aktivieren" : "deaktivieren"}`, { method: "POST" }),
  einstellungen: () => aufruf<Einstellungen>("/api/einstellungen"),
  einstellungenSpeichern: (e: Einstellungen) => aufruf<Einstellungen>("/api/einstellungen", json(e)),
  verfahrensdoku: () => aufruf<Verfahrensdoku>("/api/verfahrensdoku"),
  sperren: () => aufruf<Sperre[]>("/api/sperren"),
  sperreAnlegen: (eingabe: { grund: string; von: string; bis: string }) =>
    aufruf<Sperre>("/api/sperren", json(eingabe)),
  sperreAufheben: (id: string) => aufruf<Sperre>(`/api/sperren/${id}/aufheben`, { method: "POST" }),
  verarbeitung: () => aufruf<{ textOffen: number }>("/api/verarbeitung"),
  fristvorlagen: () => aufruf<Fristvorlage[]>("/api/fristvorlagen"),
  fristvorlageAnlegen: (v: { name: string; monate: number }) => aufruf<Fristvorlage>("/api/fristvorlagen", json(v)),
  fristvorlageLoeschen: (id: string) => aufruf<{ ok: true }>(`/api/fristvorlagen/${id}`, { method: "DELETE" }),
  uebersicht: () => aufruf<Uebersicht>("/api/fristen/uebersicht"),
  pruefung: (dateien = false) =>
    aufruf<{ ok: boolean; befunde: Befund[]; dateienGeprueft?: number; bericht: Bericht }>(
      `/api/pruefung${dateien ? "?dateien=1" : ""}`,
    ),
  kette: () => aufruf<{ lauf: Kettenpruefung | null; zeitstempel: Bericht["zeitstempel"] }>("/api/kette"),
  ketteJetztPruefen: () => aufruf<Kettenpruefung>("/api/kette/pruefen", { method: "POST" }),
  zeitstempel: () =>
    aufruf<{ id: string; seq: number; hash: string; dienst: string; zeit: string; seriennummer: string }[]>(
      "/api/zeitstempel",
    ),
};
