import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { POSTFACH_PASSWORT, POSTFACH_PASSWORT_FALSCH, postfachAusfuellen } from "./postfach-zugang.ts";

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function axeHellUndDunkel(page: Page, was: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, `${was}, ${colorScheme}`).toEqual([]);
  }
}

test("falsches Passwort: Meldung, nichts gespeichert, Eingaben bleiben; mit richtigem Passwort läuft der erste Abruf", async ({
  page,
}, info) => {
  const name = `assistent-${info.project.name}`;
  await page.goto("/quellen");
  const postfaecher = page.locator("section", { has: page.getByRole("heading", { name: "Postfächer" }) });
  await postfachAusfuellen(postfaecher, {
    name,
    benutzer: `${name}@example.org`,
    passwort: POSTFACH_PASSWORT_FALSCH,
  });
  await postfaecher.getByRole("button", { name: "Postfach anlegen" }).click();

  // Fehler: Meldung in drei Teilen mit Fokus, Rohtext eingeklappt, das Passwortfeld markiert
  const meldung = postfaecher.getByRole("alert");
  await expect(meldung).toContainText("Die Anmeldung wurde abgelehnt.");
  await expect(meldung).toContainText("Gespeichert ist nichts, deine Eingaben stehen noch da.");
  await expect(meldung).toContainText("Prüfe den Benutzer und gib das Passwort neu ein.");
  await expect(meldung).toBeFocused();
  await expect(meldung.getByText("Details")).toBeVisible();
  await expect(postfaecher.getByLabel("Passwort")).toHaveAttribute("aria-invalid", "true");
  await expect(postfaecher.getByLabel("Passwort")).toHaveAccessibleDescription(/Die Anmeldung wurde abgelehnt\./);
  await expect(postfaecher.getByLabel("Benutzer")).not.toHaveAttribute("aria-invalid", "true");

  // Alle Eingaben stehen noch da, auch das Passwort; gespeichert ist nichts
  await expect(postfaecher.getByLabel("Name")).toHaveValue(name);
  await expect(postfaecher.getByLabel("Benutzer")).toHaveValue(`${name}@example.org`);
  await expect(postfaecher.getByLabel("Passwort")).toHaveValue(POSTFACH_PASSWORT_FALSCH);
  await expect(postfaecher.getByLabel("Port")).toHaveValue("1");
  await expect(postfaecher.getByLabel("TLS")).not.toBeChecked();
  const quellen = await (await page.request.get("/api/quellen")).json();
  expect(quellen.map((q: { name: string }) => q.name)).not.toContain(name);
  await axeHellUndDunkel(page, "Fehlerfall");

  // Der Knopf in der Meldung führt ins Feld; mit dem richtigen Passwort ist das Postfach da
  await meldung.getByRole("button", { name: "Passwort neu eingeben" }).click();
  await expect(postfaecher.getByLabel("Passwort")).toBeFocused();
  await postfaecher.getByLabel("Passwort").fill(POSTFACH_PASSWORT);
  await expect(postfaecher.getByLabel("Passwort")).not.toHaveAttribute("aria-invalid", "true");
  await postfaecher.getByRole("button", { name: "Postfach anlegen" }).click();

  // Erfolg: Zeile in der Karte (kein Toast) mit Link zum Eingang, das Postfach steht in der Liste
  const erfolg = postfaecher.getByRole("status").filter({ hasText: `Postfach „${name}“ angelegt.` });
  await expect(erfolg).toContainText("Erster Abruf läuft, neue Mails erscheinen im Eingang.");
  await expect(erfolg.getByRole("link", { name: "Zum Eingang" })).toHaveAttribute("href", "/eingang");
  await expect(erfolg).toBeFocused();
  const eintrag = postfaecher.getByRole("listitem").filter({ hasText: name });
  await expect(eintrag).toContainText(`${name}@example.org@`);
  // Eine Ebene: der Eintrag ist eine Zeile mit Trennlinie, keine Karte in der Karte
  await expect(eintrag).toHaveCSS("border-left-width", "0px");
  await expect(eintrag).toHaveCSS("border-radius", "0px");
  await axeHellUndDunkel(page, "Erfolgsfall");

  // Aufräumen
  await eintrag.getByRole("button", { name: `Postfach „${name}“ entfernen` }).click();
  await page
    .getByRole("dialog", { name: `Postfach „${name}“ entfernen?` })
    .getByRole("button", { name: "Entfernen" })
    .click();
  await expect(eintrag).toHaveCount(0);
});

test("Abbrechen führt zur Liste zurück, der Fokus kehrt zum Knopf zurück", async ({ page }) => {
  await page.goto("/quellen");
  const postfaecher = page.locator("section", { has: page.getByRole("heading", { name: "Postfächer" }) });
  const einstieg = postfaecher.getByRole("button", { name: "Postfach hinzufügen", exact: true });
  await einstieg.click();
  await expect(postfaecher.getByRole("heading", { name: "Postfach hinzufügen" })).toBeFocused();
  await postfaecher.getByRole("button", { name: "Abbrechen" }).click();
  await expect(einstieg).toBeFocused();
});
