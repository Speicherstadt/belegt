import {
  abschnitt,
  KERN_TEXTE,
  kernAbschnitt,
  tagInDeutschland,
  type VerfahrensdokuAbschnitt,
} from "@firsttris/gobd-kern/verfahrensdoku";

/**
 * Abschnitt 4 der Verfahrensdokumentation: Sperren, Audit-Log, Hash-Kette, Siegel, Prüfung, Prüfwert und Dateispeicher
 * mit den Texten des GoBD-Kerns (kernAbschnitt). Belegt nutzt dessen SQL-Vorlage unverändert (drizzle/0000_gobd_kern.sql)
 * und den Dateispeicher des Kerns oder einen S3-Speicher mit denselben Zusagen (SHA-256 als Schlüssel, beim Lesen
 * geprüft). Was nur Belegt betrifft, steht hinter dem Kerntext, zu dem es gehört: Rechte der Anmeldung je Art von
 * Tabelle, Ort der Dateien, wo die Prüfung aufgerufen wird, Zeitstempel und Befunde bei Erstellung.
 */

/** Versiegelte Tabellen (belegt_seal_table in den Migrationen), in Worten */
const VERSIEGELT = [
  "Dokumente, ab dem Einfügen",
  "Archivnummern, ab dem Einfügen",
  "Einordnungen mit Art, Frist und dem Namen des Korrespondenten beim Einordnen, ab dem Einfügen",
  "Mails und die Verknüpfung ihrer Anhänge, ab dem Einfügen",
  "Löschnachweise, sobald die Löschung bestätigt ist",
  "Verknüpfungen abgeleiteter Dokumente mit ihrer Quelle, ab dem Einfügen",
  "Ergebnisse je Dokument eines Imports aus Paperless-ngx, ab dem Einfügen",
  "Zeitstempel zum Kopf der Kette, ab dem Einfügen",
];

export function unveraenderbarkeit({
  rechte,
  pruefwert,
  objektsperre,
  stempel,
  befunde,
}: {
  rechte: { absatz: string; liste: string[] };
  pruefwert: { seq: number; hash: string } | null;
  objektsperre: boolean;
  stempel?: { dienst: string; zeit: Date; seq: number };
  /** Befunde der Prüfung von Kette, Kopf und Siegeln, gerechnet bei Erstellung des Dokuments */
  befunde: number;
}): VerfahrensdokuAbschnitt {
  const kern = kernAbschnitt("4. Unveränderbarkeit und Nachvollziehbarkeit", {
    versiegelt: VERSIEGELT,
    pruefwert,
    dateien: true,
  });
  const speicher = objektsperre
    ? "Die Dateien liegen in einem S3-Bucket mit Object Lock im Modus COMPLIANCE: Bis zum Ende der längsten Frist ihrer Dokumente kann sie niemand ändern oder löschen, auch nicht mit dem Schlüssel des Kontos."
    : "Die Dateien liegen im Dateisystem des Servers.";
  const pruefung = [
    "Aufrufen lässt sie sich unter „Prüfung“; dort vergleicht sie auf Wunsch auch jede Datei mit ihrem Hash.",
    stempel
      ? `Einmal am Tag lässt Belegt den Kopf der Kette von einem Zeitstempeldienst nach RFC 3161 bestätigen (${stempel.dienst}); der letzte Zeitstempel vom ${tagInDeutschland(stempel.zeit)} belegt den Stand bis Eintrag ${stempel.seq}.`
      : "",
    befunde === 0
      ? "Bei Erstellung dieses Dokuments meldete die Prüfung von Kette, Kopf und Siegeln keine Befunde."
      : `Bei Erstellung dieses Dokuments meldete die Prüfung von Kette, Kopf und Siegeln ${befunde === 1 ? "einen Befund" : `${befunde} Befunde`}.`,
  ];
  // Hinter den Kerntext, zu dem sie gehören; die Tests prüfen, dass jeder Satz im Dokument steht
  const absaetze = kern.absaetze.flatMap((a) => {
    if (a.startsWith(KERN_TEXTE.siegel)) return [a, rechte.absatz];
    if (a === KERN_TEXTE.dateien) return [a, speicher];
    if (a === KERN_TEXTE.pruefung) return [a, ...pruefung];
    return [a];
  });
  return abschnitt(kern.titel, { absaetze, liste: [...(kern.liste ?? []), ...rechte.liste] });
}
