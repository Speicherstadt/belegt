import { expect, test } from "@playwright/test";
import { INHABER_EMAIL, INHABER_PASSWORT } from "./zugang.ts";

test.describe("ohne Sitzung", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("führt zur Anmeldung, lehnt ein falsches Passwort ab und meldet mit dem richtigen an", async ({ page }) => {
    await page.goto("/archiv");
    await expect(page).toHaveURL(/\/anmelden$/);
    await expect(page.getByRole("heading", { level: 1, name: "Anmelden" })).toBeVisible();

    await page.getByLabel("E-Mail-Adresse").fill(INHABER_EMAIL);
    await page.getByLabel("Passwort").fill("falsches-passwort-123");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("alert")).toContainText("Das hat nicht geklappt");

    await page.getByLabel("Passwort").fill(INHABER_PASSWORT);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();

    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/anmelden$/);
  });
});
