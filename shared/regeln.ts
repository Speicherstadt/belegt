import type { Aufbewahrungsart } from "./fristen.ts";

/*
 * Regeln schlagen beim Einordnen eine Art vor („Mails von @telekom.de sind Belege“). Ein Vorschlag ist nur ein
 * Vorschlag: Bestätigt wird er von einem Menschen oder ausdrücklich per Regel, und erst die Bestätigung setzt die Frist.
 */

export interface Bedingung {
  /** Absenderadresse genau (ohne Groß- und Kleinschreibung) */
  absender?: string;
  /** Domain des Absenders, auch Subdomains: „telekom.de“ trifft „rechnung.telekom.de“ */
  domain?: string;
  /** Teil des Betreffs, ohne Groß- und Kleinschreibung */
  betreffEnthaelt?: string;
  /** Mindestens ein Anhang dieses Typs, etwa „application/pdf“ */
  anhangTyp?: string;
}

export interface Regel {
  id: string;
  name: string;
  wenn: Bedingung;
  dann: Aufbewahrungsart;
}

export interface Merkmale {
  absender: string | null;
  betreff: string;
  anhangTypen: string[];
}

export interface Vorschlag {
  art: Aufbewahrungsart;
  regel: { id: string; name: string };
}

function trifft(b: Bedingung, m: Merkmale): boolean {
  const absender = m.absender?.toLowerCase() ?? "";
  const domain = absender.split("@")[1] ?? "";
  // Eine leere Bedingung trifft nichts, sonst ordnete eine versehentlich leere Regel alles ein
  if (!b.absender && !b.domain && !b.betreffEnthaelt && !b.anhangTyp) return false;
  if (b.absender && absender !== b.absender.toLowerCase()) return false;
  if (b.domain) {
    const d = b.domain.toLowerCase().replace(/^@/, "");
    if (domain !== d && !domain.endsWith(`.${d}`)) return false;
  }
  if (b.betreffEnthaelt && !m.betreff.toLowerCase().includes(b.betreffEnthaelt.toLowerCase())) return false;
  if (b.anhangTyp && !m.anhangTypen.some((t) => t.toLowerCase() === b.anhangTyp!.toLowerCase())) return false;
  return true;
}

/** Vorschlag der ersten Regel, deren Bedingungen alle zutreffen; null, wenn keine passt */
export function vorschlagen(regeln: Regel[], m: Merkmale): Vorschlag | null {
  const regel = regeln.find((r) => trifft(r.wenn, m));
  return regel ? { art: regel.dann, regel: { id: regel.id, name: regel.name } } : null;
}
