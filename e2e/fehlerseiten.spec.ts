import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("eine unbekannte Adresse zeigt die Meldung in der Shell, der Knopf führt ins Archiv", async ({ page }) => {
  await page.goto("/gibt-es-nicht");
  await expect(page.getByRole("heading", { level: 1, name: "Diese Seite gibt es nicht." })).toBeVisible();
  await expect(page.getByText("Deine Dokumente sind nicht betroffen.")).toBeVisible();
  // Die Seitenleiste bleibt: Die Shell umschließt die Meldung
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
  await expect(page.getByText("kaputt")).toBeHidden(); // eingeklappt unter „Details“
  const ergebnis = await new AxeBuilder({ page }).analyze();
  expect(ergebnis.violations).toEqual([]);

  kaputt = false;
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Der Server antwortet gerade nicht." })).toBeHidden();
  await expect(page.getByRole("navigation").first()).toBeVisible();
});
