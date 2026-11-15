import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const axe = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("Aktion nach dem Abholen einstellen, Löschen nur mit Bestätigung", async ({ page }, info) => {
  const name = `aktion-${info.project.name}`;
  await page.goto("/quellen");
  const postfaecher = page.locator("section", { has: page.getByRole("heading", { name: "Postfächer" }) });
  await postfaecher.getByLabel("Name").fill(name);
  await postfaecher.getByLabel("Server").fill("127.0.0.1");
  await postfaecher.getByLabel("Port").fill("1");
  await postfaecher.getByLabel("Benutzer").fill("aktion@example.org");
  await postfaecher.getByLabel("Passwort").fill("geheim-im-test");
  await postfaecher.getByLabel("TLS").uncheck();
  await postfaecher.getByRole("button", { name: "Postfach hinzufügen" }).click();
  const eintrag = postfaecher.getByRole("listitem").filter({ hasText: name });
  await expect(eintrag).toContainText("Nach dem Abholen: keine Aktion");

  // Verschieben prüft den Zielordner im Postfach; der Server ist nicht erreichbar, also wird nichts gespeichert
  await eintrag.getByRole("button", { name: "Aktion ändern" }).click();
  await eintrag.getByLabel("Aktion nach dem Abholen").selectOption("verschieben");
  await eintrag.getByLabel("Zielordner").fill("Archiv");
  await eintrag.getByRole("button", { name: "Aktion speichern" }).click();
  await expect(eintrag.getByRole("alert")).toContainText("Postfach nicht erreichbar");

  // Löschen: Hinweis, Wartezeit, und ohne Bestätigung lässt sich nicht speichern
  await eintrag.getByLabel("Aktion nach dem Abholen").selectOption("loeschen");
  await expect(eintrag.getByRole("note")).toContainText("erst nach der Wartezeit");
  await eintrag.getByLabel("Wartezeit in Stunden").fill("48");
  await eintrag.getByRole("button", { name: "Aktion speichern" }).click();
  const bestaetigung = eintrag.getByLabel("Ich bestätige, dass Belegt archivierte Mails in diesem Postfach endgültig");
  expect(await bestaetigung.evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
  await expect(eintrag).toContainText("Nach dem Abholen: keine Aktion");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
  await bestaetigung.check();
  await eintrag.getByRole("button", { name: "Aktion speichern" }).click();
  await expect(eintrag).toContainText("Nach dem Abholen: löschen, frühestens 48 h nach der Archivierung");
  await expect(eintrag).toContainText(/bestätigt von nutzer:\S+ am/);
  await eintrag.getByText("Protokoll der Aktionen").click();
  await expect(eintrag).toContainText("Noch keine Aktion.");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }

  // Zurück auf „als gelesen markieren“: die Bestätigung des Löschens fällt weg
  await eintrag.getByRole("button", { name: "Aktion ändern" }).click();
  await eintrag.getByLabel("Aktion nach dem Abholen").selectOption("gelesen");
  await eintrag.getByRole("button", { name: "Aktion speichern" }).click();
  await expect(eintrag).toContainText("Nach dem Abholen: als gelesen markieren");
  await expect(eintrag).not.toContainText("bestätigt von");
});
