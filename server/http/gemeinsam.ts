import type { Hono } from "hono";
import { z } from "zod";
import paket from "../../package.json" with { type: "json" };
import { RECHTE } from "../../shared/rollen.ts";
import type { Angemeldet, Auth } from "../auth.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import type { OeffnenMit } from "../freigabe/freigabe.ts";
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
  /** Name des OIDC-Anbieters, wenn die Anmeldung darüber eingerichtet ist */
  oidcName?: string;
  /** Die Dateien liegen in einem S3-Bucket mit Object Lock (für die Verfahrensdokumentation) */
  objektsperre?: boolean;
  /** Sprachmodell für Vorschläge, wenn eingerichtet (für die Verfahrensdokumentation) */
  kiModell?: { modell: string; host: string };
  /** Der Worker überwacht einen Eingangsordner (für die Verfahrensdokumentation) */
  eingangsordner?: boolean;
  /** Code auf Trennblättern (TRENNBLATT_CODE), Vorgabe BELEGT-TRENNER */
  trennblattCode?: string;
  /** Origin, der Belegt in einem Frame zeigen darf */
  embedOrigin?: string;
  /** App für „Öffnen mit …“ (Name und Adresse mit {url}), wenn eingerichtet */
  oeffnenMit?: OeffnenMit;
  /** Ordner für hochgeladene Exporte aus Paperless-ngx (IMPORT_ORDNER), den Server und Worker teilen */
  importOrdner?: string;
  /** Größte Datei eines Exports in Bytes (IMPORT_MAX_GB) */
  importMax?: number;
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
/** Sichtbereich eines Mitarbeiters (shared/rollen.ts); fehlende Listen sind leer */
const Ids = z.array(z.uuid()).max(200).default([]);
export const SichtbereichEingabe = z.object({
  tags: Ids,
  dokumenttypen: Ids,
  korrespondenten: Ids,
  ohneTags: Ids,
  ohneOrdnung: z.boolean().default(false),
});
export const MitarbeiterEingabe = z.object({ recht: z.enum(RECHTE), sichtbereich: SichtbereichEingabe });
export const ZugangEingabe = z.discriminatedUnion("rolle", [
  z.object({ rolle: z.literal("steuerberatung") }),
  z.object({ rolle: z.literal("pruefer"), zeitraum: Zeitraum }),
  z.object({ rolle: z.literal("mitarbeiter"), ...MitarbeiterEingabe.shape }),
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
