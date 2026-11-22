import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { menueOeffnen } from "./menue.ts";

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("Benachrichtigungen einstellen und eine Testmail schicken", async ({ page }) => {
  await page.goto("/");
  await menueOeffnen(page);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("link", { name: "Benachrichtigungen" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Benachrichtigungen" })).toBeVisible();
  await expect(page.getByText("Absender: belegt@e2e.example")).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }

  const eingang = page.getByRole("listitem").filter({ hasText: "Im Eingang liegen mehr Dokumente als" });
  await eingang.getByRole("checkbox").check();
  await eingang.getByRole("spinbutton", { name: "Dokumente" }).fill("5");
  await page.getByLabel("Weitere Adressen").fill("it@example.org");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();

  await page.reload();
  await expect(eingang.getByRole("checkbox")).toBeChecked();
  await expect(eingang.getByRole("spinbutton", { name: "Dokumente" })).toHaveValue("5");
  await expect(page.getByLabel("Weitere Adressen")).toHaveValue("it@example.org");

  await page.getByRole("button", { name: "Testmail senden" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Testmail an" })).toHaveText(
    "Testmail an anna@example.org, it@example.org gesendet.",
  );
  const gesendet = page.getByRole("region", { name: "Zuletzt gesendet" });
  await expect(gesendet.getByRole("listitem").first()).toContainText("Belegt: Testmail");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
});
