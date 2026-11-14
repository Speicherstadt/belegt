import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SEITEN = [
  { pfad: "/", titel: "Eingang" },
  { pfad: "/archiv", titel: "Archiv" },
  { pfad: "/fristen", titel: "Fristen" },
  { pfad: "/pruefung", titel: "Prüfung" },
  { pfad: "/quellen", titel: "Quellen und Schnittstellen" },
  { pfad: "/verfahrensdoku", titel: "Verfahrensdokumentation" },
];

test("der Eingang zeigt Überschrift, Navigation und den leeren Zustand", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: "Eingang" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Eingang ist leer")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

test("die Navigation führt zu jeder Seite und markiert sie", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await nav.getByRole("link", { name: "Fristen" }).click();
  await expect(page).toHaveURL(/\/fristen$/);
  await expect(page.getByRole("heading", { level: 1, name: "Fristen" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Fristen" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Eingang" })).not.toHaveAttribute("aria-current", "page");
});

test("die Fristen nennen Jahre und Grundlage nach § 147 AO", async ({ page }) => {
  await page.goto("/fristen");
  const beleg = page.getByRole("row", { name: /Buchungsbelege/ });
  await expect(beleg).toContainText("8 Jahre");
  await expect(beleg).toContainText("§ 147 Abs. 1 Nr. 4 AO");
  await expect(page.getByRole("row", { name: /Bücher/ })).toContainText("10 Jahre");
  await expect(page.getByRole("row", { name: /Geschäftsbriefe/ })).toContainText("6 Jahre");
});

test("im Archiv ist genau ein Filter gewählt", async ({ page }) => {
  await page.goto("/archiv");
  await expect(page.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Frei", exact: true }).click();
  await expect(page.getByRole("button", { name: "Frei", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "false");
});

for (const seite of SEITEN) {
  test(`${seite.titel}: ohne Verstöße gegen WCAG 2.2 AA, hell und dunkel`, async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(seite.pfad);
      await expect(page.getByRole("heading", { level: 1, name: seite.titel })).toBeVisible();
      const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(ergebnis.violations, colorScheme).toEqual([]);
    }
  });
}

test.describe("auf Englisch", () => {
  test.use({ locale: "en-US" });

  test("folgt der Sprache des Browsers", async ({ page }) => {
    await page.goto("/fristen");
    await expect(page.getByRole("heading", { level: 1, name: "Retention" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Accounting receipts/ })).toContainText("8 years");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
