import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { menueOeffnen } from "./menue.ts";

test("eine unbekannte Adresse zeigt die Meldung in der Shell, der Knopf führt ins Archiv", async ({ page }) => {
  await page.goto("/gibt-es-nicht");
  await expect(page.getByRole("heading", { level: 1, name: "Diese Seite gibt es nicht." })).toBeVisible();
  await expect(page.getByText("Deine Dokumente sind nicht betroffen.")).toBeVisible();
  // Die Seitenleiste bleibt: Die Shell umschließt die Meldung
  await menueOeffnen(page);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  const ergebnis = await new AxeBuilder({ page }).analyze();
  expect(ergebnis.violations).toEqual([]);

  await page.getByRole("link", { name: "Zum Archiv" }).click();
  await expect(page).toHaveURL(/\/archiv$/);
});

test("antwortet /api/ich nicht, steht eine Meldung statt „Lädt …“, und „Erneut versuchen“ lädt nach", async ({
  page,
}) => {
  let kaputt = true;
  await page.route("**/api/ich", (route) =>
    kaputt
      ? route.fulfill({ status: 500, contentType: "application/json", body: '{"fehler":"kaputt"}' })
      : route.fallback(),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Der Server antwortet gerade nicht." })).toBeVisible();
  await expect(page.getByText("Deine Dokumente sind nicht verloren.")).toBeVisible();
  await expect(page.getByText("Lädt …")).toHaveCount(0);
  // Der Rohtext steht eingeklappt unter „Details“ und erscheint erst beim Aufklappen
  const details = page.locator("details");
  await expect(details.getByText("Details", { exact: true })).toBeVisible();
  expect(await details.evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
  await expect(page.getByText("kaputt")).toBeHidden();
  await details.getByText("Details", { exact: true }).click();
  await expect(page.getByText("kaputt")).toBeVisible();
  const ergebnis = await new AxeBuilder({ page }).analyze();
  expect(ergebnis.violations).toEqual([]);

  kaputt = false;
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Der Server antwortet gerade nicht." })).toBeHidden();
  await menueOeffnen(page);
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("ein langer Rohtext ohne Leerzeichen sprengt die Seite nicht", async ({ page }) => {
  await page.route("**/api/ich", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ fehler: "x".repeat(2000) }) }),
  );
  await page.goto("/");
  await page.locator("details").getByText("Details", { exact: true }).click();
  const breiten = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(breiten.scroll).toBeLessThanOrEqual(breiten.client);
});

test("ein Fehler der Sitzungsabfrage mit 403 zeigt den Hinweis des Servers", async ({ page }) => {
  await page.route("**/api/ich", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ fehler: "Sichtbereich ungültig; bitte den Inhaber fragen" }),
    }),
  );
  await page.goto("/");
  await expect(page.getByText("Sichtbereich ungültig; bitte den Inhaber fragen")).toBeVisible();
  await expect(page.getByText("Der Server antwortet gerade nicht.")).toHaveCount(0);
});

test.describe("ohne Anmeldung", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("eine unbekannte Adresse führt zur Anmeldung", async ({ page }) => {
    await page.goto("/gibt-es-nicht");
    await expect(page).toHaveURL(/\/anmelden/);
  });
});
