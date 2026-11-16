import { type Anlass, laden } from "../benachrichtigungen/einstellungen.ts";
import type { Datenbank } from "../db/client.ts";

/*
 * Benachrichtigungen per Mail für die Verfahrensdokumentation (docs/betrieb.md#benachrichtigungen): ob sie eingerichtet
 * sind und bei welchen Anlässen Belegt meldet. Sie gehören zur Überwachung des Verfahrens (Sicherung, Abruf, Kette,
 * Löschanträge, Fristen).
 */

const ANLASS: Record<Anlass, string> = {
  backup: "Sicherung oder Test-Restore fehlgeschlagen oder zu alt",
  postfach: "Postfach nicht abgerufen oder Aktion im Postfach fehlgeschlagen",
  kette: "Befund der täglichen Prüfung von Kette, Kopf und Siegeln",
  loeschung: "Löschantrag wartet auf die zweite Person",
  fristen: "Fristen der nächsten 30 Tage (wöchentlich)",
  eingang: "zu viele Dokumente im Eingang",
  workflow: "fehlgeschlagene Workflows und aufgegebene Weitergaben",
};

export async function benachrichtigungenBeschreiben(db: Datenbank, eingerichtet: boolean): Promise<string> {
  if (!eingerichtet)
    return "Benachrichtigungen per Mail sind nicht eingerichtet (kein SMTP-Server); Fehler von Sicherung, Abruf und Prüfung zeigt Belegt nur auf der Startseite und unter „Prüfung“.";
  const e = await laden(db);
  const an = (Object.keys(ANLASS) as Anlass[]).filter((a) => e.anlaesse[a].an).map((a) => ANLASS[a]);
  const empfaenger = (e.anInhaber ? 1 : 0) + e.weitereEmpfaenger.length;
  return an.length
    ? `Belegt meldet per Mail an ${empfaenger} Empfänger, wenn etwas Aufmerksamkeit braucht: ${an.join("; ")}. Jede gesendete Mail steht mit Anlass, Empfängern und Betreff in einem Protokoll, das nur anwächst; Mails nennen Zahlen, Namen von Postfächern und Workflows und Archivnummern, nie Inhalte von Dokumenten.`
    : "Ein SMTP-Server für Benachrichtigungen ist eingerichtet, aber alle Anlässe sind ausgeschaltet.";
}
