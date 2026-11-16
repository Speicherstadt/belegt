import { aufruf, json } from "./api-aufruf.ts";

/* Benachrichtigungen per Mail (docs/betrieb.md#benachrichtigungen), nur für den Inhaber */

export interface Anlaesse {
  backup: { an: boolean; tage: number };
  postfach: { an: boolean; tage: number };
  kette: { an: boolean };
  loeschung: { an: boolean };
  fristen: { an: boolean };
  eingang: { an: boolean; anzahl: number };
  workflow: { an: boolean };
}

export interface BenachrichtigungsEinstellungen {
  anlaesse: Anlaesse;
  anInhaber: boolean;
  weitereEmpfaenger: string[];
}

export interface Benachrichtigungen {
  /** MAIL_SMTP_URL ist gesetzt */
  eingerichtet: boolean;
  absender: string | null;
  einstellungen: BenachrichtigungsEinstellungen;
  gesendet: {
    id: number;
    anlass: string;
    betreff: string;
    empfaenger: string[];
    gesendetAm: string;
    ok: boolean;
    fehler: string | null;
  }[];
}

export const benachrichtigungenApi = {
  benachrichtigungen: () => aufruf<Benachrichtigungen>("/api/benachrichtigungen"),
  benachrichtigungenSpeichern: (e: BenachrichtigungsEinstellungen) =>
    aufruf<BenachrichtigungsEinstellungen>("/api/benachrichtigungen", { ...json(e), method: "PUT" }),
  testmail: () => aufruf<{ empfaenger: string[] }>("/api/benachrichtigungen/test", { method: "POST" }),
};
