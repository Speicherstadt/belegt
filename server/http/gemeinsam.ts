import type { Hono } from "hono";
import { z } from "zod";
import paket from "../../package.json" with { type: "json" };
import type { Angemeldet, Auth } from "../auth.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import type { Oeffnen } from "../mail/abruf.ts";
import type { OAuthKonfig } from "../mail/oauth.ts";

/** Was die HTTP-Schnittstelle von außen bekommt */
export type AppUmgebung = Umgebung & {
  auth: Auth;
  schluessel?: Buffer;
  oeffnen?: Oeffnen;
  abrufMinuten?: number;
  /** Bei Microsoft und Google registrierte Apps für IMAP mit OAuth */
  oauth?: OAuthKonfig;
  /** HTTP nach außen (OAuth); Tests geben eigenes */
  abfragen?: (url: string, init: RequestInit) => Promise<Response>;
  /** Ordner der gebauten Oberfläche; ohne ihn liefert der Server nur die Schnittstelle (Entwicklung mit Vite) */
  oberflaeche?: string;
};
export type App = Hono<{ Variables: { nutzer: Angemeldet } }>;

/** Typen, die der Browser gefahrlos anzeigen kann; kein SVG und kein HTML, die Skripte enthalten könnten */
export const ANSICHT = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Größte Datei je Upload */
export const MAX_UPLOAD = 100 * 1024 * 1024;

export const Id = z.uuid();

export const VERSION = paket.version;
export const Zeitraum = z.object({ von: z.iso.date(), bis: z.iso.date() });
export const ZugangEingabe = z.discriminatedUnion("rolle", [
  z.object({ rolle: z.literal("steuerberatung") }),
  z.object({ rolle: z.literal("pruefer"), zeitraum: Zeitraum }),
]);

/** Heutiger Tag in Deutschland, für Fristen (JJJJ-MM-TT) */
export const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

/** Dateiname für filename* nach RFC 8187: encodeURIComponent lässt ' ( ) * stehen, die dort nicht erlaubt sind */
export const dateinameKodiert = (name: string) =>
  encodeURIComponent(name).replace(/['()*]/g, (z) => `%${z.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Ob eine schreibende Anfrage von einer fremden Seite kommt (CSRF): Das Cookie schickt der Browser auch bei Formularen
 * anderer Seiten unter derselben Domain mit. Browser setzen Origin und Sec-Fetch-Site; Aufrufe ohne beide (curl,
 * andere Programme) laufen weiter.
 */
export function vonFremderSeite(headers: Headers, eigeneHerkunft: string): boolean {
  const seite = headers.get("sec-fetch-site");
  if (seite === "cross-site" || seite === "same-site") return true;
  const herkunft = headers.get("origin");
  return herkunft !== null && herkunft !== eigeneHerkunft;
}

/** Akteur im Audit-Log: wer angemeldet ist, mit Adresse, damit das Protokoll ohne die Tabelle user lesbar bleibt */
export const akteur = (n: Angemeldet) => (n.token ? `token:${n.token.name}` : `nutzer:${n.email}`);
