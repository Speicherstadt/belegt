import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("„Was ist das?“ bei der Sperre öffnet und schließt per Tastatur und zeigt den Fokus", async ({ page }) => {
  await page.goto("/fristen");
  const knopf = page.getByRole("button", { name: "Was ist „Sperre“?" });
  const satz = page.getByText("Eine Sperre hält die Dokumente eines Zeitraums fest");
  await expect(knopf).toHaveAttribute("aria-expanded", "false");
  await expect(satz).toBeHidden();

  await knopf.focus();
  await expect(knopf).toBeFocused();
  // Fokusring: eine sichtbare Kontur, nicht nur die Voreinstellung des Browsers
  expect(await knopf.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe("2px");

  await page.keyboard.press("Enter");
  await expect(knopf).toHaveAttribute("aria-expanded", "true");
  await expect(satz).toBeVisible();
  await expect(page.getByRole("link", { name: "Mehr im Glossar" })).toHaveAttribute("href", /glossar\.html#sperre$/);

  await page.keyboard.press("Space");
  await expect(knopf).toHaveAttribute("aria-expanded", "false");
  await expect(satz).toBeHidden();

  await page.keyboard.press("Space");
  const ergebnis = await new AxeBuilder({ page }).analyze();
  expect(ergebnis.violations).toEqual([]);
});

test("der Satz schiebt Inhalt nach unten, aber nicht zur Seite, auch auf dem Handy", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const knopf = page.getByRole("button", { name: "Was ist „Hash-Kette“?" });
  const zeile = knopf.locator("xpath=ancestor::dt");
  // Seitenkoordinate: Der Klick darf die Seite scrollen, ohne dass die Zeile als verschoben gilt
  const oben = (e: Element) => e.getBoundingClientRect().top + window.scrollY;
  const davor = await zeile.evaluate(oben);
  const ziel = await knopf.boundingBox();
  expect(ziel!.width).toBeGreaterThanOrEqual(40);
  expect(ziel!.height).toBeGreaterThanOrEqual(40);

  await knopf.click();
  const satz = page.getByText("Jeder Eintrag im Verlauf enthält den Fingerabdruck");
  await expect(satz).toBeVisible();
  // Die Zeile mit dem Begriff bleibt, wo sie war; der Satz steht darunter
  expect(await zeile.evaluate(oben)).toBe(davor);
  expect(await satz.evaluate(oben)).toBeGreaterThan(davor);
  expect(await satz.evaluate((e) => getComputedStyle(e).fontSize)).toBe("16px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
