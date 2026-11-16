import type { BackupStand } from "../betrieb/backup.ts";

const zeit = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

/**
 * Datensicherung für die Verfahrensdokumentation (Abschnitt 7) aus backup_status: Ziel, Rhythmus, letzter Lauf und
 * letzter Test-Restore, wie der Backup-Container sie eingetragen hat. Ohne Eintrag nichts; dann beschreibt der Betrieb
 * die Sicherung in den Angaben.
 */
export function sicherungBeschreiben(b: BackupStand): string[] {
  const l = b.letztesBackup;
  if (b.zustand === "keins") return [];
  const absaetze: string[] = [];
  if (l)
    absaetze.push(
      `Der Backup-Container sichert die Datenbank (pg_dump) und die Originale, verschlüsselt mit restic${l.ziel ? ` nach ${l.ziel}` : ""}${l.zeitplan ? `, ${l.zeitplan}` : ""}. Aufbewahrt werden 14 tägliche, 24 monatliche und 11 jährliche Stände. Die letzte Sicherung lief am ${zeit(l.am)}${l.snapshot ? ` (Stand ${l.snapshot})` : ""}.`,
    );
  absaetze.push(
    b.letzterTest
      ? `Beim Test-Restore spielt der Container eine Sicherung in eine Wegwerf-Datenbank ein und prüft sie mit der Prüfung von Belegt: Hash-Kette, Kopf, Siegel und jedes Original gegen seinen Hash. Zuletzt bestanden am ${zeit(b.letzterTest.am)}: ${b.letzterTest.meldung}`
      : "Ein Test-Restore ist noch nicht gelaufen.",
  );
  for (const f of b.fehlgeschlagen)
    absaetze.push(
      `${f.art === "backup" ? "Die letzte Sicherung" : "Der letzte Test-Restore"} am ${zeit(f.lauf.am)} schlug fehl: ${f.lauf.meldung || "ohne Meldung"}`,
    );
  if (b.ueberfaellig) absaetze.push("Seit mehr als zwei Tagen lief keine Sicherung erfolgreich durch.");
  return absaetze;
}
