import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/*
 * Das Menü: am Desktop dauerhaft in drei Gruppen, unter 1024 px (Projekt handy, 412 px) als Fläche hinter dem Knopf
 * „Menü“. Menüwort und Seitentitel sind dieselben Wörter.
 */

test("am Desktop stehen drei Gruppen, Menüwort und Seitentitel gleich", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Dauerhafte Seitenleiste gibt es nur am Desktop");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  for (const gruppe of ["Dokumente", "Ordnen und prüfen", "Einrichten"])
    await expect(nav.getByRole("list", { name: gruppe })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menü" })).toBeHidden();
  for (const wort of ["Quellen", "Verfahrensdokumentation"]) {
    await nav.getByRole("link", { name: wort }).click();
    await expect(page.getByRole("heading", { level: 1, name: wort })).toBeVisible();
  }
  const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(ergebnis.violations).toEqual([]);
});

test.describe("am Handy", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "handy", "Das Menü hinter dem Knopf gibt es nur am Handy");
    await page.goto("/");
  });

  test("öffnet und schließt mit Knopf, Escape und Klick daneben", async ({ page }) => {
    const knopf = page.getByRole("button", { name: "Menü" });
    const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();

    await knopf.click();
    await expect(knopf).toHaveAttribute("aria-expanded", "true");
    await expect(nav).toBeVisible();
    const ergebnis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(ergebnis.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
    await expect(knopf).toBeFocused();

    await knopf.click();
    await page.mouse.click(400, 400);
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
  });

  test("ein Eintrag navigiert und klappt das Menü zu", async ({ page }) => {
    const knopf = page.getByRole("button", { name: "Menü" });
    await knopf.click();
    await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Fristen" }).click();
    await expect(page).toHaveURL(/\/fristen$/);
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
  });

  test("nach dem Scrollen bleibt der Knopf oben, Tab bleibt in der Leiste, Zurück schließt", async ({ page }) => {
    await page.goto("/archiv");
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
    });
    const knopf = page.getByRole("button", { name: "Menü" });
    await knopf.click();
    await expect(knopf).toHaveAttribute("aria-expanded", "true");
    // Erst nach dem Öffnen scrollen: Playwright holt den Knopf vor einem Klick selbst in den Blick
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(knopf).toBeInViewport();
    expect((await knopf.boundingBox())?.y).toBeLessThan(56);

    // Der Inhalt ist inert: Tab erreicht nichts in main
    await expect(page.locator("main")).toHaveAttribute("inert", "");
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(false);
    }

    await page.goBack();
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
  });
});
