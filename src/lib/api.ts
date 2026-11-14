import type { Rolle } from "../../shared/rollen.ts";

/* Aufrufe der Schnittstelle (docs/api.md); Cookies der Sitzung schickt der Browser mit */

export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function aufruf<T>(pfad: string, init?: RequestInit): Promise<T> {
  const res = await fetch(pfad, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const text = await res.text();
    let meldung = text;
    try {
      const json = JSON.parse(text) as { fehler?: string; message?: string };
      meldung = json.fehler ?? json.message ?? text;
    } catch {}
    throw new ApiFehler(res.status, meldung);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface Ich {
  id: string;
  email: string;
  role: Rolle;
  /** Nur beim Prüfer: der freigegebene Zeitraum */
  zeitraum?: { von: string; bis: string };
}

export interface Dokument {
  id: string;
  sha256: string;
  groesse: number;
  mimeType: string;
  dateiname: string | null;
  quelle: string;
  eingegangenAm: string;
}

export type Art = "buecher" | "zoll" | "beleg" | "geschaeftsbrief" | "sonstige" | "freiwillig" | "frei";
export type Gruppe = "alle" | "offen" | "pflicht" | "freiwillig" | "frei" | "loeschbar" | "geloescht";

export interface Eintrag extends Dokument {
  art: Art | null;
  fristBis: string | null;
  titel: string | null;
}

export interface Einordnung {
  id: string;
  art: Art;
  entstanden: string;
  fristBis: string | null;
  titel: string | null;
  korrespondent: string | null;
  erstelltAm: string;
}

export interface Loeschung {
  id: string;
  dokumentId: string;
  beantragtVon: string;
  beantragtAm: string;
  bestaetigtVon: string | null;
  bestaetigtAm: string | null;
  dateiname?: string | null;
}

export interface MailAnsicht {
  messageId: string | null;
  von: string | null;
  an: string[];
  betreff: string;
  gesendetAm: string | null;
  text: string;
  anhaenge: { dokumentId: string; dateiname: string | null; mimeType: string; eingebettet: boolean }[];
  unterhaltung: { dokumentId: string; betreff: string; von: string | null; gesendetAm: string | null }[];
  ausMail: string | null;
}

export interface Regel {
  id: string;
  name: string;
  reihenfolge: number;
  bedingung: { absender?: string; domain?: string; betreffEnthaelt?: string; anhangTyp?: string };
  art: Art;
  aktiv: boolean;
}

export interface Quelle {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  benutzer: string;
  ordner: string;
  letzteUid: number;
  letzterAbruf: string | null;
  letzterFehler: string | null;
  aktiv: boolean;
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

export interface Zugaenge {
  zugaenge: {
    id: string;
    email: string;
    rolle: Rolle;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    erstelltAm: string;
  }[];
  einladungen: {
    id: string;
    rolle: Rolle;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    erstelltAm: string;
    gueltigBis: string;
    eingeloestAm: string | null;
    eingeloestVon: string | null;
    zurueckgezogenAm: string | null;
  }[];
}

export interface Ereignis {
  seq: number;
  at: string;
  akteur: string | null;
  aktion: string;
  tabelle: string;
}

export interface Befund {
  art: string;
  tabelle: string;
  zeile: string | null;
  seq: number | null;
  befund: string;
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

export const api = {
  einstellungen: () => aufruf<Einstellungen>("/api/einstellungen"),
  einstellungenSpeichern: (e: Einstellungen) => aufruf<Einstellungen>("/api/einstellungen", json(e)),
  verfahrensdoku: () => aufruf<Verfahrensdoku>("/api/verfahrensdoku"),
  status: () => aufruf<{ eingerichtet: boolean }>("/api/status"),
  ich: () => aufruf<Ich>("/api/ich"),
  einrichten: (email: string, passwort: string, code: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", {
      ...json({ email, password: passwort, name: email }),
      headers: { "content-type": "application/json", "x-belegt-einrichtungscode": code },
    }),
  einladung: (token: string) =>
    aufruf<{ rolle: Rolle; zeitraumVon: string | null; zeitraumBis: string | null }>(
      `/api/einladung/${encodeURIComponent(token)}`,
    ),
  einladungAnnehmen: (token: string, email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", {
      ...json({ email, password: passwort, name: email }),
      headers: { "content-type": "application/json", "x-belegt-einladung": token },
    }),
  zugaenge: () => aufruf<Zugaenge>("/api/zugaenge"),
  einladen: (rolle: "steuerberatung" | "pruefer", zeitraum?: { von: string; bis: string }) =>
    aufruf<{ id: string; pfad: string }>(
      "/api/einladungen",
      json(rolle === "pruefer" ? { rolle, zeitraum } : { rolle }),
    ),
  zurueckziehen: (id: string) => aufruf<unknown>(`/api/einladungen/${id}/zurueckziehen`, { method: "POST" }),
  anmelden: (email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-in/email", json({ email, password: passwort })),
  abmelden: () => aufruf<unknown>("/api/auth/sign-out", json({})),
  dokumente: (suche: string, gruppe: Gruppe = "alle") =>
    aufruf<Eintrag[]>(`/api/dokumente?suche=${encodeURIComponent(suche)}&gruppe=${gruppe}`),
  dokument: (id: string) =>
    aufruf<Dokument & { einordnung: Einordnung | null; loeschung: Loeschung | null }>(`/api/dokumente/${id}`),
  loeschungBeantragen: (id: string) => aufruf<Loeschung>(`/api/dokumente/${id}/loeschung`, { method: "POST" }),
  loeschungen: () => aufruf<Loeschung[]>("/api/loeschungen"),
  loeschungBestaetigen: (id: string) => aufruf<Loeschung>(`/api/loeschungen/${id}/bestaetigen`, { method: "POST" }),
  loeschungZurueckziehen: (id: string) => aufruf<unknown>(`/api/loeschungen/${id}`, { method: "DELETE" }),
  einordnen: (
    id: string,
    eingabe: { art: Art; entstanden: string; freiwilligBis?: string; titel?: string; korrespondent?: string },
  ) => aufruf<Einordnung>(`/api/dokumente/${id}/einordnung`, json(eingabe)),
  mailsImportieren: (datei: File) => {
    const form = new FormData();
    form.append("datei", datei);
    return aufruf<{ neu: string[]; doppelt: string[] }>("/api/mails", { method: "POST", body: form });
  },
  mail: async (id: string): Promise<MailAnsicht | null> => {
    try {
      return await aufruf<MailAnsicht>(`/api/dokumente/${id}/mail`);
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 404) return null;
      throw err;
    }
  },
  vorschlag: (id: string) =>
    aufruf<{ vorschlag: { art: Art; regel: { id: string; name: string } } | null }>(`/api/dokumente/${id}/vorschlag`),
  regeln: () => aufruf<Regel[]>("/api/regeln"),
  regelAnlegen: (r: { name: string; wenn: Regel["bedingung"]; dann: Art }) => aufruf<Regel>("/api/regeln", json(r)),
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
  }) => aufruf<Quelle>("/api/quellen", json(q)),
  quelleAbrufen: (id: string) =>
    aufruf<{ neu: number; doppelt: number; fehler: string | null }>(`/api/quellen/${id}/abrufen`, { method: "POST" }),
  sperren: () => aufruf<Sperre[]>("/api/sperren"),
  sperreAnlegen: (eingabe: { grund: string; von: string; bis: string }) =>
    aufruf<Sperre>("/api/sperren", json(eingabe)),
  sperreAufheben: (id: string) => aufruf<Sperre>(`/api/sperren/${id}/aufheben`, { method: "POST" }),
  uebersicht: () => aufruf<Uebersicht>("/api/fristen/uebersicht"),
  verlauf: (id: string) => aufruf<{ ereignisse: Ereignis[]; siegel: string | null }>(`/api/dokumente/${id}/verlauf`),
  hochladen: (datei: File) => {
    const form = new FormData();
    form.append("datei", datei);
    return aufruf<Dokument>("/api/dokumente", { method: "POST", body: form });
  },
  pruefung: (dateien = false) =>
    aufruf<{ ok: boolean; befunde: Befund[]; dateienGeprueft?: number }>(`/api/pruefung${dateien ? "?dateien=1" : ""}`),
};

export const exportUrl = (von: string, bis: string) =>
  `/api/export?von=${encodeURIComponent(von)}&bis=${encodeURIComponent(bis)}`;

export const dateiUrl = (id: string, ansicht = false) => `/api/dokumente/${id}/datei${ansicht ? "?ansicht=1" : ""}`;
