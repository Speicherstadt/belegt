import type { Locator } from "@playwright/test";

/*
 * Testzugang für Postfächer in den E2E-Tests: Hosts unter .test beantwortet e2e/server.ts mit einem nachgebauten
 * Postfach (server/mail/test-postfach.ts), alle anderen Hosts gehen ins echte Netz. Mit einem anderen Passwort lehnt
 * das Postfach die Anmeldung ab.
 */
export const POSTFACH_HOST = "imap.belegt.test";
export const POSTFACH_PASSWORT = "geheim-im-test";
/** Beliebiges anderes Passwort wird abgelehnt; dieses ist der Wert für den Fehlerfall */
export const POSTFACH_PASSWORT_FALSCH = "falsch";
/** Ein Benutzer mit diesem Anfang kommt nur beim ersten Öffnen (Prüfung beim Anlegen) hinein, danach ist das Postfach nicht erreichbar */
export const POSTFACH_UNTERBROCHEN = "unterbrochen";

/** Öffnet in der Karte „Postfächer“ den Assistenten und füllt ihn aus; abgeschickt wird nicht (Knopf „Postfach anlegen“) */
export async function postfachAusfuellen(
  karte: Locator,
  w: { name: string; benutzer: string; passwort?: string; ordner?: string },
) {
  await karte.getByRole("button", { name: "Postfach hinzufügen", exact: true }).click();
  await karte.getByLabel("Name").fill(w.name);
  await karte.getByLabel("Server").fill(POSTFACH_HOST);
  await karte.getByLabel("Benutzer").fill(w.benutzer);
  await karte.getByLabel("Passwort").fill(w.passwort ?? POSTFACH_PASSWORT);
  if (w.ordner) await karte.getByLabel("Ordner").fill(w.ordner);
  // Port und TLS stehen unter „Erweitert“; der Testserver hört auf keinem Port mit TLS
  await karte.getByText("Erweitert: Art, Port und TLS").click();
  await karte.getByLabel("Port").fill("1");
  await karte.getByLabel("TLS").uncheck();
}
