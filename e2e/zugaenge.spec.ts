import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("der Inhaber lädt die Steuerberatung ein; sie liest, lädt aber nichts hoch", async ({ page, browser }, info) => {
  await page.goto("/zugaenge");
  await expect(page.getByRole("heading", { level: 1, name: "Zugänge" })).toBeVisible();
  await page.getByLabel("Rolle").selectOption("steuerberatung");
  await page.getByRole("button", { name: "Einladen" }).click();
  const link = await page.getByRole("status").locator("code").textContent();
  expect(link).toMatch(/\/einladung\/[A-Za-z0-9_-]{40,}$/);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);

  const fremd = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });
  const kanzlei = await fremd.newPage();
  try {
    await kanzlei.goto(link!);
    await expect(kanzlei.getByText("Du wurdest als Steuerberatung eingeladen")).toBeVisible();
    await kanzlei.getByLabel("E-Mail-Adresse").fill(`kanzlei-${info.project.name}@example.org`);
    await kanzlei.getByLabel("Passwort").fill("ein-langes-kanzlei-passwort");
    await kanzlei.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(kanzlei.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
    await expect(kanzlei.getByRole("button", { name: "Hochladen" })).toHaveCount(0);
    await expect(kanzlei.getByRole("link", { name: "Zugänge" })).toHaveCount(0);

    await kanzlei.goto(link!);
    await expect(kanzlei.getByText("Diese Einladung ist ungültig")).toBeVisible();
  } finally {
    await fremd.close();
  }

  await page.reload();
  await expect(page.getByText(`kanzlei-${info.project.name}@example.org`).first()).toBeVisible();
});
