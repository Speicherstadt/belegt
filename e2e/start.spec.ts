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

test("der Eingang zeigt Überschrift und Navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(nav.getByRole("link", { name: "Eingang" })).toHaveAttribute("aria-current", "page");
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

for (const seite of SEITEN) {
  test(`${seite.titel}: ohne Verstöße gegen WCAG 2.2 AA, hell und dunkel`, async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(seite.pfad);
      await expect(page.getByRole("heading", { level: 1, name: seite.titel })).toBeVisible();
      // WCAG 2.4.2: jede Seite hat ihren eigenen Titel
      await expect(page).toHaveTitle(`${seite.titel} · Belegt`);
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
    const beleg = page.getByRole("row", { name: /Accounting receipts/ });
    await expect(beleg).toContainText("8 years");
    // Auch die Grundlage kommt aus Paraglide, zitiert wie in den übrigen englischen Texten
    await expect(beleg).toContainText("§ 147 (1) no. 4 AO");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
