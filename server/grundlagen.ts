import paket from "../package.json" with { type: "json" };
import type { Angemeldet } from "./auth.ts";

/*
 * Werte, die die HTTP-Schnittstelle und die Module darunter (Mail, MCP, Paperless-Import) teilen. Sie liegen hier und
 * nicht in http/gemeinsam.ts, damit diese Module nicht die Schnittstelle importieren, die sie selbst einbindet
 * (checks cycles).
 */

/** Größte Datei je Upload */
export const MAX_UPLOAD = 100 * 1024 * 1024;

export const VERSION = paket.version;

/** Heutiger Tag in Deutschland, für Fristen (JJJJ-MM-TT) */
export const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

/** Akteur im Audit-Log: wer angemeldet ist, mit Adresse, damit das Protokoll ohne die Tabelle user lesbar bleibt */
export const akteur = (n: Angemeldet) => (n.token ? `token:${n.token.name}` : `nutzer:${n.email}`);
