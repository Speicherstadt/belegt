import type { Recht } from "../../shared/rollen.ts";
import { EIGENES_KONTO } from "./konto.ts";

/*
 * Was ein Mitarbeiter aufrufen darf (docs/zugaenge.md): eine Liste wie beim Prüfer (server/zugang/pruefer.ts), alles
 * andere lehnt die Middleware mit 403 ab. Welche Dokumente er dabei sieht, entscheidet server/zugang/sicht.ts.
 * Nie: Löschungen, Sperren, Fristen, Prüfung, Export, Einstellungen, Zugänge, Tokens, Workflows, Regeln, Quellen,
 * Import, Webhooks, MCP, Teilen per Link, „Öffnen mit …“, Seiten bearbeiten und die Listen von Tags und Co. ändern.
 */

const LESEN = [
  /^\/api\/ich$/,
  /^\/api\/start$/,
  /^\/api\/dokumente$/,
  /^\/api\/dokumente\/[^/]+(\/(datei|ansicht|archivfassung|inhalt|mail|verlauf|vorschaubild|ableitungen|aehnliche|notizen|seiten|seiten\/\d+))?$/,
  /^\/api\/(tags|dokumenttypen|korrespondenten|felder)$/,
];

/** Mit dem Recht bearbeiten: hochladen, einordnen, Ordnung setzen, Notizen; Vorschläge und Trennblatt dazu */
const BEARBEITEN_LESEN = [/^\/api\/dokumente\/[^/]+\/vorschlag$/, /^\/api\/trennblatt\.pdf$/];
const BEARBEITEN = [
  /^\/api\/dokumente$/,
  /^\/api\/dokumente\/sammeln$/,
  /^\/api\/dokumente\/[^/]+\/(einordnung|ordnung|notizen|notizen\/[^/]+\/zurueckziehen)$/,
];

/** Eigene gespeicherte Ansichten und Kacheln der Startseite pflegt jede Rolle; sie zeigen nur, was sie ohnehin sieht */
const EIGENE_ANSICHTEN = /^\/api\/(ansichten(\/[^/]+)?|start\/kacheln)$/;

export function mitarbeiterDarf(recht: Recht, methode: string, pfad: string): boolean {
  if (EIGENE_ANSICHTEN.test(pfad) || EIGENES_KONTO.test(pfad)) return true;
  if (methode === "GET" || methode === "HEAD")
    return LESEN.some((r) => r.test(pfad)) || (recht === "bearbeiten" && BEARBEITEN_LESEN.some((r) => r.test(pfad)));
  return recht === "bearbeiten" && methode === "POST" && BEARBEITEN.some((r) => r.test(pfad));
}
