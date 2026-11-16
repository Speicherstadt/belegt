import { datenbankRollenText } from "@firsttris/gobd-kern/verfahrensdoku";
import { type Datenbankzugriff, PROBLEME } from "../db/rollen.ts";

/**
 * Datenbankrollen für die Verfahrensdokumentation (Abschnitt 4): mit welcher Anmeldung die Anwendung arbeitet und welche
 * Rechte sie je Art von Tabelle wirksam hat, gelesen aus der Datenbank, nicht aus der Konfiguration. Den Satz zur
 * Anmeldung liefert der GoBD-Kern (datenbankRollenText); er sagt nur zu, was zugriffLesen prüft (Eigentum, Superuser-
 * und Rollenrechte, Anlegen von Objekten und Triggern, Replikationsmodus).
 */
export function rechteBeschreiben(z: Datenbankzugriff): { absatz: string; liste: string[] } {
  const kern = datenbankRollenText({
    anmeldung: z.anmeldung,
    eingeschraenkt: z.eingeschraenkt,
    probleme: z.probleme.map((p) => PROBLEME[p]),
  });
  if (!z.eingeschraenkt) return { absatz: kern, liste: [] };
  const art = (name: string, wahl: (t: Datenbankzugriff["tabellen"][number]) => boolean) => {
    const tabellen = z.tabellen.filter(wahl).map((t) => t.tabelle);
    return tabellen.length ? [`${name} (${tabellen.length}): ${tabellen.join(", ")}`] : [];
  };
  return {
    absatz: `${kern} Mit dieser Anmeldung arbeiten Server, Worker und SMTP-Journal; Tabellen leeren kann sie auch nicht. Die Migrationen laufen beim Start mit der Eigentümerrolle und vergeben danach genau die Rechte, die die Liste unten je Art von Tabelle nennt.`,
    liste: [
      ...art("Nur lesen", (t) => t.select && !t.insert && !t.update && !t.delete),
      ...art("Nur ergänzen (lesen und einfügen)", (t) => t.insert && !t.update && !t.delete),
      ...art("Fortschreiben nur über Trigger (lesen und ändern)", (t) => t.update && !t.insert && !t.delete),
      ...art("Lesen und schreiben, Sperren prüfen die Trigger", (t) => t.select && t.insert && t.update && t.delete),
    ],
  };
}
