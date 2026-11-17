import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("ein neues Token erscheint einmal, lässt sich kopieren und läuft auf dem Handy nicht über", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/quellen");
  const bereich = page.getByRole("region", { name: "API-Tokens" });
  await bereich.getByLabel("Name").fill(`Kopieren ${info.project.name}`);
  await bereich.getByRole("button", { name: "Token anlegen" }).click();

  const wert = bereich.getByTestId("einmalwert");
  const token = (await wert.locator("code").textContent())!;
  expect(token).toMatch(/^belegt_/);
  await expect(wert.getByText("Wird nur jetzt angezeigt.")).toBeVisible();
  // Die Live-Region ist leer, bis kopiert wurde, und enthält nie den Wert selbst
  const meldung = wert.getByRole("status");
  await expect(meldung).toBeEmpty();
  await wert.getByRole("button", { name: "Kopieren" }).click();
  await expect(meldung).toHaveText("Kopiert.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);

  const ergebnis = await new AxeBuilder({ page }).analyze();
  expect(ergebnis.violations).toEqual([]);

  // Auf dem Handy bricht der lange Wert um, statt die Seite zu verbreitern
  await page.setViewportSize({ width: 375, height: 800 });
  const breite = await wert.evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(breite[0]).toBeLessThanOrEqual(breite[1]!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("ohne Zwischenablage bleibt der Wert da und die Meldung sagt, dass Kopieren nicht geht", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await page.goto("/quellen");
  const bereich = page.getByRole("region", { name: "API-Tokens" });
  await bereich.getByLabel("Name").fill(`Ohne Zwischenablage ${info.project.name}`);
  await bereich.getByRole("button", { name: "Token anlegen" }).click();
  const wert = bereich.getByTestId("einmalwert");
  await wert.getByRole("button", { name: "Kopieren" }).click();
  await expect(wert.getByRole("status")).toHaveText("Kopieren nicht möglich, bitte den Wert markieren.");
  await expect(wert.locator("code")).toHaveText(/^belegt_/);
});
