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
export type Gruppe = "alle" | "offen" | "pflicht" | "freiwillig" | "frei";

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
  zugaenge: { id: string; email: string; rolle: Rolle; erstelltAm: string }[];
  einladungen: {
    id: string;
    rolle: Rolle;
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

export const api = {
  status: () => aufruf<{ eingerichtet: boolean }>("/api/status"),
  ich: () => aufruf<Ich>("/api/ich"),
  einrichten: (email: string, passwort: string, code: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", {
      ...json({ email, password: passwort, name: email }),
      headers: { "content-type": "application/json", "x-belegt-einrichtungscode": code },
    }),
  einladung: (token: string) => aufruf<{ rolle: Rolle }>(`/api/einladung/${encodeURIComponent(token)}`),
  einladungAnnehmen: (token: string, email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", {
      ...json({ email, password: passwort, name: email }),
      headers: { "content-type": "application/json", "x-belegt-einladung": token },
    }),
  zugaenge: () => aufruf<Zugaenge>("/api/zugaenge"),
  einladen: (rolle: "steuerberatung" | "pruefer") =>
    aufruf<{ id: string; pfad: string }>("/api/einladungen", json({ rolle })),
  zurueckziehen: (id: string) => aufruf<unknown>(`/api/einladungen/${id}/zurueckziehen`, { method: "POST" }),
  anmelden: (email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-in/email", json({ email, password: passwort })),
  abmelden: () => aufruf<unknown>("/api/auth/sign-out", json({})),
  dokumente: (suche: string, gruppe: Gruppe = "alle") =>
    aufruf<Eintrag[]>(`/api/dokumente?suche=${encodeURIComponent(suche)}&gruppe=${gruppe}`),
  dokument: (id: string) => aufruf<Dokument & { einordnung: Einordnung | null }>(`/api/dokumente/${id}`),
  einordnen: (
    id: string,
    eingabe: { art: Art; entstanden: string; freiwilligBis?: string; titel?: string; korrespondent?: string },
  ) => aufruf<Einordnung>(`/api/dokumente/${id}/einordnung`, json(eingabe)),
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
  pruefung: () => aufruf<{ ok: boolean; befunde: Befund[] }>("/api/pruefung"),
};

export const dateiUrl = (id: string, ansicht = false) => `/api/dokumente/${id}/datei${ansicht ? "?ansicht=1" : ""}`;
