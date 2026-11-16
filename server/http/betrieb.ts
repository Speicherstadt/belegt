import { backupStand } from "../betrieb/backup.ts";
import { zugriffLesen } from "../db/rollen.ts";
import type { App, AppUmgebung } from "./gemeinsam.ts";

/*
 * Betrieb: wirksame Rechte der Datenbankanmeldung (docs/betrieb.md#getrennte-datenbankrollen) und Stand der Sicherung
 * (docs/betrieb.md#sichern). Lesen dürfen Inhaber und Steuerberatung; Mitarbeiter, Prüfer und Tokens nicht (Listen
 * in server/zugang/).
 */
export function betriebRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/betrieb", async (c) => {
    const [datenbank, backup] = await Promise.all([zugriffLesen(umgebung.db.$client), backupStand(umgebung.db)]);
    return c.json({ datenbank, backup });
  });
}
