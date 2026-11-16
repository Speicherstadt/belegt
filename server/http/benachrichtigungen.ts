import type { Angemeldet } from "../auth.ts";
import { protokoll, testmail } from "../benachrichtigungen/benachrichtigen.ts";
import {
  EinstellungenEingabe,
  laden as einstellungenLaden,
  speichern as einstellungenSpeichern,
} from "../benachrichtigungen/einstellungen.ts";
import { type App, type AppUmgebung, akteur } from "./gemeinsam.ts";

/*
 * Benachrichtigungen per Mail (docs/betrieb.md#benachrichtigungen): Einstellungen, letzte gesendete und Testmail, nur
 * für den Inhaber mit Sitzung. Verschickt wird im Worker; die Adresse des SMTP-Servers und das Passwort nennt keine
 * Antwort, nur ob der Versand eingerichtet ist und mit welchem Absender.
 */
const nurInhaber = (n: Angemeldet) => n.role === "inhaber" && !n.token;

export function benachrichtigungenRouten(app: App, umgebung: AppUmgebung) {
  const { db } = umgebung;
  const basisUrl = String(umgebung.auth.options.baseURL);

  app.get("/api/benachrichtigungen", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const [einstellungen, gesendet] = await Promise.all([einstellungenLaden(db), protokoll(db)]);
    return c.json({
      eingerichtet: !!umgebung.mail,
      absender: umgebung.mail?.absender ?? null,
      einstellungen,
      gesendet,
    });
  });

  app.put("/api/benachrichtigungen", async (c) => {
    const nutzer = c.get("nutzer");
    if (!nurInhaber(nutzer)) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const eingabe = EinstellungenEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültige Einstellungen", details: eingabe.error.issues }, 400);
    return c.json(await einstellungenSpeichern(db, eingabe.data, akteur(nutzer)));
  });

  app.post("/api/benachrichtigungen/test", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    if (!umgebung.mail) return c.json({ fehler: "Kein Versand eingerichtet (MAIL_SMTP_URL)" }, 503);
    const r = await testmail({ db, versender: umgebung.mail.versender, basisUrl });
    return r.fehler
      ? c.json({ fehler: r.fehler, empfaenger: r.empfaenger }, 502)
      : c.json({ empfaenger: r.empfaenger });
  });
}
