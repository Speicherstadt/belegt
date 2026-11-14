import AxeBuilder from "@axe-core/playwright";
import { expect, test as setup } from "@playwright/test";
import { INHABER } from "../playwright.config.ts";
import { INHABER_EMAIL, INHABER_PASSWORT } from "./zugang.ts";

setup("Belegt über die Oberfläche einrichten, das erste Konto ist der Inhaber", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/anmelden$/);
  await expect(page.getByRole("heading", { level: 1, name: "Belegt einrichten" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByLabel("Einrichtungscode").fill("falsch");
  await page.getByLabel("E-Mail-Adresse").fill(INHABER_EMAIL);
  await page.getByLabel("Passwort").fill(INHABER_PASSWORT);
  await page.getByRole("button", { name: "Einrichten" }).click();
  await expect(page.getByRole("alert")).toContainText("Einrichtungscode stimmt nicht");

  await page.getByLabel("Einrichtungscode").fill("e2e-einrichtungscode");
  await page.getByLabel("Passwort").fill(INHABER_PASSWORT);
  await page.getByRole("button", { name: "Einrichten" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await expect(page.getByText(INHABER_EMAIL)).toBeVisible();
  await page.context().storageState({ path: INHABER });
});
