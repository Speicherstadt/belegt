import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

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

async function tokenAnlegen(page: Page, name: string) {
  const bereich = page.getByRole("region", { name: "API-Tokens" });
  await bereich.getByLabel("Name").fill(name);
  await bereich.getByRole("button", { name: "Token anlegen" }).click();
  return bereich.getByTestId("einmalwert");
}

test("lehnt die Zwischenablage ab, sagt die Meldung es, und der Wert bleibt", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("abgelehnt", "NotAllowedError"));
  });
  await page.goto("/quellen");
  const wert = await tokenAnlegen(page, `Abgelehnt ${info.project.name}`);
  await wert.getByRole("button", { name: "Kopieren" }).click();
  await expect(wert.getByRole("status")).toHaveText("Kopieren nicht möglich, bitte den Wert markieren.");
  await expect(wert.locator("code")).toHaveText(/^belegt_/);
});

test("ein neuer Wert beginnt ohne Rückmeldung des alten", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/quellen");
  const wert = await tokenAnlegen(page, `Erstes ${info.project.name}`);
  await wert.getByRole("button", { name: "Kopieren" }).click();
  await expect(wert.getByRole("status")).toHaveText("Kopiert.");
  const alt = await wert.locator("code").textContent();
  await tokenAnlegen(page, `Zweites ${info.project.name}`);
  await expect(wert.locator("code")).not.toHaveText(alt!);
  await expect(wert.getByRole("status")).toBeEmpty();
});

test("per Tastatur erreichbar: der Fokus auf dem Wert markiert ihn ganz", async ({ page }, info) => {
  await page.goto("/quellen");
  const wert = await tokenAnlegen(page, `Tastatur ${info.project.name}`);
  const token = (await wert.locator("code").textContent())!;
  await wert.getByRole("button", { name: "Kopieren" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(wert.locator("code")).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(token);
});

for (const fall of ["Erfolg", "Fehler"] as const) {
  test(`die Rückmeldung (${fall}) lässt die Höhe des Kastens unverändert`, async ({ page, context }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    if (fall === "Fehler") {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      });
    }
    await page.goto("/quellen");
    const wert = await tokenAnlegen(page, `Höhe ${fall} ${info.project.name}`);
    const vorher = (await wert.boundingBox())!.height;
    await wert.getByRole("button", { name: "Kopieren" }).click();
    await expect(wert.getByRole("status")).not.toBeEmpty();
    expect((await wert.boundingBox())!.height).toBe(vorher);
  });
}

test("die Fehlermeldung beim Kopieren lässt die Höhe auch in der schmalen Seitenspalte des Dokuments unverändert", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  // Laptop-Breite: Vorschau und Seitenspalte stehen nebeneinander, die Spalte ist knapp 300 px breit
  await page.setViewportSize({ width: 1100, height: 900 });
  const name = `hoehe-spalte-${info.project.name}.pdf`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\n%Hoehe ${info.project.name}\n`),
  });
  await page.getByRole("link", { name }).click();
  await page.getByRole("tab", { name: "Weiteres" }).click();
  const bereich = page.getByRole("region", { name: "Teilen per Link" });
  await bereich.getByRole("button", { name: "Link anlegen" }).click();
  const wert = bereich.getByTestId("einmalwert");
  const vorher = (await wert.boundingBox())!.height;
  await wert.getByRole("button", { name: "Kopieren" }).click();
  await expect(wert.getByRole("status")).toHaveText("Kopieren nicht möglich, bitte den Wert markieren.");
  expect((await wert.boundingBox())!.height).toBe(vorher);
});
