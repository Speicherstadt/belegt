import type { QuelleOhneGeheimnis } from "../mail/abruf.ts";

/* Aktionen im Postfach nach dem Abholen für die Verfahrensdokumentation (server/mail/aktionen.ts) */

const tagUndZeit = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);

/** Die Aktion eines Postfachs in Worten; bei Löschen mit Wartezeit, Sperre und Bestätigung */
export function postfachAktion(q: QuelleOhneGeheimnis): string {
  if (q.aktion === "gelesen") return "als gelesen markieren";
  if (q.aktion === "markieren") return "markieren (Flagge)";
  if (q.aktion === "verschieben") return `in den Ordner „${q.aktionZielPfad ?? q.aktionZiel}“ verschieben`;
  if (q.aktion === "loeschen")
    return `löschen, frühestens ${q.loeschenWarteStunden === 1 ? "1 Stunde" : `${q.loeschenWarteStunden} Stunden`} nach der Archivierung${q.loeschenNachSperre ? " und erst mit Sperre im Bucket" : ""}; ausdrücklich bestätigt von ${q.loeschenBestaetigtVon ?? "?"} am ${q.loeschenBestaetigtAm ? tagUndZeit(q.loeschenBestaetigtAm) : "?"}`;
  return "keine Aktion, nur lesend";
}

/** Absatz zur Erfassung: wie Aktionen im Postfach abgesichert sind, nur wenn eine eingestellt ist */
export function postfachAktionenAbsatz(quellen: QuelleOhneGeheimnis[]): string {
  if (quellen.every((q) => q.aktion === "keine"))
    return "Belegt ruft die Postfächer nur lesend ab; es markiert, verschiebt und löscht dort nichts.";
  return [
    "Für einzelne Postfächer ist eine Aktion nach dem Abholen eingestellt (Liste unten). Sie läuft erst, wenn die Mail vollständig archiviert ist: Die Datenbank hat die Aufnahme festgeschrieben, und vor jeder Aktion liest Belegt das Original aus dem Speicher und vergleicht seinen SHA-256.",
    quellen.some((q) => q.aktion === "loeschen")
      ? "Löschen im Postfach muss der Inhaber ausdrücklich bestätigen; es geschieht frühestens nach der eingestellten Wartezeit ab der Archivierung, damit eine Sicherung des Archivs dazwischen liegt, und nur, wenn die Mail im Postfach Byte für Byte dem Original im Archiv gleicht."
      : "",
    "Jede Aktion steht mit Mail, Postfach, Ordner, UID oder Email-ID, Zeit und Ergebnis in einem Protokoll, das nur anwächst; Fehler werden festgehalten und höchstens fünfmal wiederholt.",
  ]
    .filter(Boolean)
    .join(" ");
}
