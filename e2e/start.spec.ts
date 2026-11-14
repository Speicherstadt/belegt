import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("der Eingang zeigt Überschrift, Navigation und den leeren Zustand", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Eingang" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Eingang ist leer")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

test("ohne Verstöße gegen WCAG 2.2 AA, hell und dunkel", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(ergebnis.violations, colorScheme).toEqual([]);
  }
});

test.describe("auf Englisch", () => {
  test.use({ locale: "en-US" });

  test("folgt der Sprache des Browsers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
