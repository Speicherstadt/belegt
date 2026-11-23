import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DEMO_URL } from "../playwright.config.ts";

/*
 * Die Demo (src/demo/): dieselbe App unter /demo/, ohne Server, aus der Aufnahme in demo/aufnahme.json. Sie zeigt die
 * Beispieldaten der Bilder, sucht und filtert selbst und lehnt Änderungen mit einem Hinweis ab.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test("die Demo zeigt die Beispieldaten ohne Server und sagt, dass sie nichts ändert", async ({ page }) => {
  await page.goto(DEMO_URL);
  await expect(page.getByText("Demo mit Testdaten")).toBeVisible();
  await expect(page.getByRole("link", { name: "Belegt installieren" })).toHaveAttribute(
    "href",
    "https://belegt.store/",
  );
  await expect(page.getByRole("heading", { name: "Überblick" })).toBeVisible();
  await expect(page.getByText("Dokumente im Archiv")).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }

  // Das Archiv unter /demo/, die Suche filtert in der Seite
  await page.goto(`${DEMO_URL}archiv`);
  await expect(page.getByRole("heading", { level: 1, name: "Archiv" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Strom Oktober" })).toBeVisible();
  await page.getByPlaceholder(/Volltext/).fill("Kranich");
  await expect(page.getByRole("link", { name: "Strom Oktober" })).toHaveCount(0);
  await page.getByRole("link", { name: "Rechnung HK-2026-1187", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/dokumente\//);
  await expect(page.getByRole("heading", { level: 1, name: "Rechnung HK-2026-1187", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Verlauf" }).click();
  await expect(page.getByRole("tab", { name: "Verlauf", selected: true })).toBeVisible();

  // Ändern geht nicht, die Meldung sagt warum
  await page.goto(`${DEMO_URL}ordnung?bereich=tags`);
  const tags = page.locator("section", { has: page.getByRole("heading", { name: "Tags", exact: true }) });
  await tags.getByLabel("Neuer Tag").fill("Demo-Tag");
  await tags.getByRole("button", { name: "Tag anlegen" }).click();
  await expect(page.getByText("In der Demo nicht möglich", { exact: false })).toBeVisible();
});
