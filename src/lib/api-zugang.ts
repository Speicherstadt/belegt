import type { Recht, Rolle, Sichtbereich } from "../../shared/rollen.ts";
import { geteilteVerwerfen } from "../pwa/teilen.ts";
import { aufruf, json } from "./api-aufruf.ts";

/* Anmelden, Einrichten, Einladungen, Zugänge und API-Tokens (docs/api.md) */

export interface Ich {
  id: string;
  email: string;
  role: Rolle;
  /** Nur beim Prüfer: der freigegebene Zeitraum */
  zeitraum?: { von: string; bis: string };
  /** Nur beim Mitarbeiter: Recht und Sichtbereich */
  recht?: Recht;
  sichtbereich?: Sichtbereich;
  /** Die Pflicht zum zweiten Faktor gilt, und diese Sitzung hat keinen: erst auf der Seite Konto einrichten */
  zweiFaktorEinrichten?: boolean;
}

/** Eine Einladung: Steuerberatung, Prüfer mit Zeitraum oder Mitarbeiter mit Recht und Sichtbereich */
export type NeuerZugang =
  | { rolle: "steuerberatung" }
  | { rolle: "pruefer"; zeitraum: { von: string; bis: string } }
  | { rolle: "mitarbeiter"; recht: Recht; sichtbereich: Sichtbereich };

export interface Zugaenge {
  zugaenge: {
    id: string;
    email: string;
    rolle: Rolle;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    recht: Recht | null;
    sichtbereich: Sichtbereich | null;
    entzogenAm: string | null;
    erstelltAm: string;
    zweiFaktor: { totp: boolean; passkeys: number };
    /** Das Konto hat ein Passwort; sonst gibt es keins zurückzusetzen */
    passwort: boolean;
  }[];
  einladungen: {
    id: string;
    rolle: Rolle;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    recht: Recht | null;
    sichtbereich: Sichtbereich | null;
    erstelltAm: string;
    gueltigBis: string;
    eingeloestAm: string | null;
    eingeloestVon: string | null;
    zurueckgezogenAm: string | null;
  }[];
}

export interface ApiToken {
  id: string;
  name: string;
  recht: "lesen" | "schreiben";
  erstelltAm: string;
  widerrufenAm: string | null;
}

export const zugangApi = {
  status: () =>
    aufruf<{
      eingerichtet: boolean;
      oidc: { name: string } | null;
      embedOrigin: string | null;
      version: string;
      oeffnenMit: { name: string } | null;
      /** E-Rechnungen werden mit dem KoSIT-Validator geprüft */
      erechnungPruefung: boolean;
    }>("/api/status"),
  /** Anmelden über den OIDC-Anbieter; stumm: prompt=none, ohne Rückfrage beim Anbieter (im Frame) */
  anmeldenMitAnbieter: async (ziel: string, stumm = false) => {
    const { url } = await aufruf<{ url: string }>(
      "/api/auth/sign-in/social",
      json({
        provider: "oidc",
        callbackURL: ziel,
        errorCallbackURL: "/anmelden",
        ...(stumm ? { additionalParams: { prompt: "none" } } : {}),
      }),
    );
    window.location.assign(url);
  },
  /** Das angemeldete Konto mit dem OIDC-Anbieter verbinden */
  verbindenMitAnbieter: async () => {
    const { url } = await aufruf<{ url: string }>(
      "/api/auth/link-social",
      json({ provider: "oidc", callbackURL: window.location.pathname, errorCallbackURL: window.location.pathname }),
    );
    window.location.assign(url);
  },
  konten: () => aufruf<{ providerId: string }[]>("/api/auth/list-accounts"),
  ich: () => aufruf<Ich>("/api/ich"),
  einrichten: (email: string, passwort: string, code: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", {
      ...json({ email, password: passwort, name: email }),
      headers: { "content-type": "application/json", "x-belegt-einrichtungscode": code },
    }),
  einladung: (token: string) =>
    aufruf<{ rolle: Rolle; zeitraumVon: string | null; zeitraumBis: string | null; recht?: Recht }>(
      `/api/einladung/${encodeURIComponent(token)}`,
    ),
  einladungAnnehmen: (token: string, email: string, passwort: string) =>
    aufruf<unknown>("/api/auth/sign-up/email", {
      ...json({ email, password: passwort, name: email }),
      headers: { "content-type": "application/json", "x-belegt-einladung": token },
    }),
  zugaenge: () => aufruf<Zugaenge>("/api/zugaenge"),
  einladen: (zugang: NeuerZugang) => aufruf<{ id: string; pfad: string }>("/api/einladungen", json(zugang)),
  mitarbeiterAendern: (id: string, recht: Recht, sichtbereich: Sichtbereich) =>
    aufruf<unknown>(`/api/zugaenge/${encodeURIComponent(id)}`, { ...json({ recht, sichtbereich }), method: "PATCH" }),
  entziehen: (id: string) => aufruf<unknown>(`/api/zugaenge/${encodeURIComponent(id)}/entziehen`, { method: "POST" }),
  /** Die Antwort nennt den Pfad des Links einmal */
  passwortZuruecksetzen: (id: string) =>
    aufruf<{ pfad: string }>(`/api/zugaenge/${encodeURIComponent(id)}/passwort-zuruecksetzen`, { method: "POST" }),
  passwortSetzen: (token: string, passwort: string) =>
    aufruf<unknown>(`/api/passwort/${encodeURIComponent(token)}`, json({ passwort })),
  zurueckziehen: (id: string) => aufruf<unknown>(`/api/einladungen/${id}/zurueckziehen`, { method: "POST" }),
  /** Mit zweitem Faktor kommt statt der Sitzung { twoFactorRedirect: true } */
  anmelden: (email: string, passwort: string) =>
    aufruf<{ twoFactorRedirect?: boolean }>("/api/auth/sign-in/email", json({ email, password: passwort })),
  // Geteilte Dateien, die noch nicht hochgeladen sind, bleiben nach dem Abmelden nicht im Browser
  abmelden: async () => {
    await geteilteVerwerfen();
    return aufruf<unknown>("/api/auth/sign-out", json({}));
  },
  tokens: () => aufruf<ApiToken[]>("/api/tokens"),
  tokenAnlegen: (name: string, recht: ApiToken["recht"]) =>
    aufruf<ApiToken & { klartext: string }>("/api/tokens", json({ name, recht })),
  tokenWiderrufen: (id: string) => aufruf<unknown>(`/api/tokens/${id}/widerrufen`, { method: "POST" }),
};
