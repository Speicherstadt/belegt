import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { POSTFACH_HOST, postfachAusfuellen } from "./postfach-zugang.ts";

const axe = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("ein Postfach lässt sich ändern und nach Rückfrage entfernen", async ({ page }, info) => {
  const name = `aendern-${info.project.name}`;
  await page.goto("/quellen");
  const postfaecher = page.locator("section", { has: page.getByRole("heading", { name: "Postfächer" }) });
  await postfachAusfuellen(postfaecher, { name, benutzer: "aendern@example.org" });
  await postfaecher.getByRole("button", { name: "Postfach anlegen" }).click();
  const eintrag = postfaecher.getByRole("listitem").filter({ hasText: name });
  await expect(eintrag).toContainText(`aendern@example.org@${POSTFACH_HOST}:1/INBOX`);

  // Ein anderer Server verlangt das Passwort neu; ohne lässt sich nicht speichern
  await eintrag.getByRole("button", { name: `Postfach „${name}“ ändern` }).click();
  await eintrag.getByLabel("Server").fill("neu.example.org");
  const passwort = eintrag.getByLabel("Passwort");
  await expect(passwort).toHaveAccessibleDescription(/Gib das Passwort neu ein/);
  await eintrag.getByRole("button", { name: "Speichern" }).click();
  expect(await passwort.evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
  await passwort.fill("neues-geheimnis-im-test");
  await eintrag.getByRole("button", { name: "Speichern" }).click();
  await expect(eintrag).toContainText("aendern@example.org@neu.example.org:1/INBOX");
  await expect(eintrag.getByLabel("Passwort")).toHaveCount(0);

  // Abbrechen im Dialog lässt das Postfach stehen, Bestätigen entfernt es
  await eintrag.getByRole("button", { name: `Postfach „${name}“ entfernen` }).click();
  const dialog = page.getByRole("dialog", { name: `Postfach „${name}“ entfernen?` });
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(eintrag).toBeVisible();
  await eintrag.getByRole("button", { name: `Postfach „${name}“ entfernen` }).click();
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(eintrag).toHaveCount(0);
  await expect(postfaecher.getByRole("heading", { name: "Postfächer" })).toBeFocused();
});
