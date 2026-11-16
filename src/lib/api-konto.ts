import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Rolle } from "../../shared/rollen.ts";
import { aufruf, json } from "./api-aufruf.ts";

/*
 * Konto und zweiter Faktor (docs/zugaenge.md#zwei-faktor): TOTP, Backup-Codes und Passkeys über die Plugins von
 * Better Auth unter /api/auth/, Stand, QR-Code, Pflicht und Zurücksetzen über /api/konto und /api/zwei-faktor.
 */

export interface Konto {
  totp: boolean;
  passkeys: { id: string; name: string | null; erstelltAm: string | null }[];
  /** Ohne Passwort (nur über den OIDC-Anbieter) lässt sich TOTP nicht einrichten */
  passwort: boolean;
  pflicht: boolean;
  einrichten: boolean;
}

/** Antwort auf die Anmeldung mit Passwort, wenn ein zweiter Schritt folgt */
export interface ZweiterSchritt {
  twoFactorRedirect: true;
  twoFactorMethods: string[];
}

export const kontoApi = {
  konto: () => aufruf<Konto>("/api/konto"),
  qr: (text: string) => aufruf<{ groesse: number; pfad: string }>("/api/konto/qr", json({ text })),
  /** Erzeugt Geheimnis und Backup-Codes; gilt erst nach totpBestaetigen */
  totpAnlegen: (passwort: string) =>
    aufruf<{ totpURI: string; backupCodes: string[] }>("/api/auth/two-factor/enable", json({ password: passwort })),
  /** Bestätigt beim Einrichten oder ist der zweite Schritt der Anmeldung */
  totpPruefen: (code: string) => aufruf<unknown>("/api/auth/two-factor/verify-totp", json({ code })),
  backupCodePruefen: (code: string) => aufruf<unknown>("/api/auth/two-factor/verify-backup-code", json({ code })),
  totpEntfernen: (passwort: string) => aufruf<unknown>("/api/auth/two-factor/disable", json({ password: passwort })),
  backupCodesNeu: (passwort: string) =>
    aufruf<{ backupCodes: string[] }>("/api/auth/two-factor/generate-backup-codes", json({ password: passwort })),
  /** Neuer Passkey: Optionen vom Server, Schlüssel im Browser, Prüfung auf dem Server */
  passkeyHinzufuegen: async (name: string) => {
    const optionen = await aufruf<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
      "/api/auth/passkey/generate-register-options",
    );
    const antwort = await startRegistration({ optionsJSON: optionen });
    return aufruf<{ id: string }>("/api/auth/passkey/verify-registration", json({ response: antwort, name }));
  },
  passkeyUmbenennen: (id: string, name: string) =>
    aufruf<unknown>("/api/auth/passkey/update-passkey", json({ id, name })),
  passkeyEntfernen: (id: string) => aufruf<unknown>("/api/auth/passkey/delete-passkey", json({ id })),
  passkeyAnmelden: async () => {
    const optionen = await aufruf<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
      "/api/auth/passkey/generate-authenticate-options",
    );
    const antwort = await startAuthentication({ optionsJSON: optionen });
    return aufruf<unknown>("/api/auth/passkey/verify-authentication", json({ response: antwort }));
  },
  zweiFaktorPflicht: () => aufruf<{ pflicht: Rolle[] }>("/api/zwei-faktor"),
  zweiFaktorPflichtSetzen: (rollen: Rolle[]) =>
    aufruf<{ pflicht: Rolle[] }>("/api/zwei-faktor", { ...json({ rollen }), method: "PUT" }),
  zweiFaktorZuruecksetzen: (id: string) =>
    aufruf<unknown>(`/api/zugaenge/${encodeURIComponent(id)}/zwei-faktor-zuruecksetzen`, { method: "POST" }),
};
