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
  einrichten: (email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", json({ email, password: passwort, name: email })),
  anmelden: (email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-in/email", json({ email, password: passwort })),
  abmelden: () => aufruf<unknown>("/api/auth/sign-out", json({})),
  dokumente: (suche: string) => aufruf<Dokument[]>(`/api/dokumente?suche=${encodeURIComponent(suche)}`),
  dokument: (id: string) => aufruf<Dokument>(`/api/dokumente/${id}`),
  verlauf: (id: string) => aufruf<{ ereignisse: Ereignis[]; siegel: string | null }>(`/api/dokumente/${id}/verlauf`),
  hochladen: (datei: File) => {
    const form = new FormData();
    form.append("datei", datei);
    return aufruf<Dokument>("/api/dokumente", { method: "POST", body: form });
  },
  pruefung: () => aufruf<{ ok: boolean; befunde: Befund[] }>("/api/pruefung"),
};

export const dateiUrl = (id: string, ansicht = false) => `/api/dokumente/${id}/datei${ansicht ? "?ansicht=1" : ""}`;
