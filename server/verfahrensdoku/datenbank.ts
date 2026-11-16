import { type Datenbankzugriff, problemText } from "../db/rollen.ts";

/**
 * Datenbankrollen für die Verfahrensdokumentation (Abschnitt 4): mit welcher Anmeldung die Anwendung arbeitet und welche
 * Rechte sie je Art von Tabelle wirksam hat, gelesen aus der Datenbank, nicht aus der Konfiguration.
 */
export function rechteBeschreiben(z: Datenbankzugriff): { absatz: string; liste: string[] } {
  if (!z.eingeschraenkt)
    return {
      absatz: `Die Anwendung meldet sich derzeit als „${z.anmeldung}“ an, mit mehr Rechten als nötig: ${problemText(z.probleme)} Die Sperren in der Datenbank gelten für jede Änderung, die die Anwendung macht; mit diesen Rechten könnte sie sie aber abschalten. Getrennte Rollen sind noch einzurichten.`,
      liste: [],
    };
  const art = (name: string, wahl: (t: Datenbankzugriff["tabellen"][number]) => boolean) => {
    const tabellen = z.tabellen.filter(wahl).map((t) => t.tabelle);
    return tabellen.length ? [`${name} (${tabellen.length}): ${tabellen.join(", ")}`] : [];
  };
  return {
    absatz: `Die Anwendung (Server, Worker, SMTP-Journal) meldet sich als „${z.anmeldung}“ an, eine eigene Rolle ohne Eigentum an Tabellen, ohne Superuser- und Rollenrechte und ohne das Recht, Tabellen zu leeren, Trigger anzulegen oder abzuschalten oder den Replikationsmodus zu setzen. Nur die Migrationen beim Start laufen mit der Eigentümerrolle; sie vergeben danach genau diese Rechte. Die wirksamen Rechte der Anwendung je Art von Tabelle stehen in der Liste unten.`,
    liste: [
      ...art("Nur lesen", (t) => t.select && !t.insert && !t.update && !t.delete),
      ...art("Nur ergänzen (lesen und einfügen)", (t) => t.insert && !t.update && !t.delete),
      ...art("Fortschreiben nur über Trigger (lesen und ändern)", (t) => t.update && !t.insert && !t.delete),
      ...art("Lesen und schreiben, Sperren prüfen die Trigger", (t) => t.select && t.insert && t.update && t.delete),
    ],
  };
}
