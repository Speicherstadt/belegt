import type { Zeitraum } from "./einladungen.ts";

/**
 * Prüferzugang (Z1, GoBD Rz. 165): nur lesen, nur Dokumente des freigegebenen Zeitraums, nur Archiv und Prüfung.
 * Ein Dokument gehört zum Zeitraum nach belegt_dokument_tag (Entstehung, sonst Eingang), wie beim Z3-Export.
 */

const ERLAUBT = [
  /^\/api\/ich$/,
  /^\/api\/start$/,
  /^\/api\/dokumente$/,
  /^\/api\/dokumente\/[^/]+(\/(datei|ansicht|archivfassung|inhalt|mail|verlauf|vorschaubild|ableitungen|aehnliche))?$/,
  /^\/api\/(tags|dokumenttypen|korrespondenten|felder)$/,
  /^\/api\/export$/,
  /^\/api\/pruefung$/,
  /^\/api\/zeitstempel(\/[^/]+\/token)?$/,
];

/**
 * Seine eigenen gespeicherten Ansichten und die Kacheln seiner Startseite pflegt auch der Prüfer; sie zeigen nur, was er
 * ohnehin sieht
 */
const EIGENE_ANSICHTEN = /^\/api\/(ansichten(\/[^/]+)?|start\/kacheln)$/;

export const prueferDarf = (methode: string, pfad: string): boolean =>
  EIGENE_ANSICHTEN.test(pfad) || ((methode === "GET" || methode === "HEAD") && ERLAUBT.some((r) => r.test(pfad)));

/** Sammelaufrufe unter /api/dokumente/, die kein einzelnes Dokument meinen; ihre IDs prüft die Route selbst */
const SAMMEL = new Set(["sammeln", "zusammenfuegen"]);

/** Die Dokument-ID eines Pfads unter /api/dokumente/:id, sonst null */
export const dokumentImPfad = (pfad: string): string | null => {
  const id = /^\/api\/dokumente\/([^/]+)/.exec(pfad)?.[1] ?? null;
  return id && !SAMMEL.has(id) ? id : null;
};

/** Der Zeitraum aus dem Zugang; ohne beide Tage (ältere Zugänge) ein leerer, in dem nichts liegt */
export const prueferZeitraum = (von: unknown, bis: unknown): Zeitraum =>
  typeof von === "string" && typeof bis === "string" && von <= bis
    ? { von, bis }
    : { von: "9999-12-31", bis: "0001-01-01" };

/** Schnittmenge zweier Zeiträume oder null, wenn sie sich nicht überschneiden */
export function schnitt(a: Zeitraum, b: Zeitraum): Zeitraum | null {
  // Tage als JJJJ-MM-TT lassen sich als Text sortieren
  const von = [a.von, b.von].sort()[1]!;
  const bis = [a.bis, b.bis].sort()[0]!;
  return von <= bis ? { von, bis } : null;
}
