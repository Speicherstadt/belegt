import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const axe = (page: Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function pdf(text: string) {
  const doc = await PDFDocument.create();
  doc.setSubject(`umbruch-${text}-${Date.now()}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { x: 50, y: 700, size: 18, font });
  return Buffer.from(await doc.save());
}

/** Seitliches Scrollen: Die Seite ist breiter als das Fenster (Messung aus Issue #3) */
async function breiteUeberschuss(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("bei 390 px Breite", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Verfahrensdokumentation scrollt nicht seitwärts", async ({ page }) => {
    await page.goto("/verfahrensdoku");
    await expect(page.getByRole("heading", { level: 1, name: "Verfahrensdokumentation" })).toBeVisible();
    await expect(page.getByText(/^Stand .* · Belegt /)).toBeVisible();
    expect(await breiteUeberschuss(page)).toBeLessThanOrEqual(0);
    expect((await axe(page)).violations).toEqual([]);
  });

  test("Dokumentseite mit Prüfwert scrollt nicht seitwärts", async ({ page }, info) => {
    // Lange Dateinamen ohne Leerzeichen sind bei Scans üblich
    const name = `umbruch-${info.project.name}-${"x".repeat(70)}.pdf`;
    await page.goto("/archiv");
    await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer: await pdf("Umbruch") });
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.locator("dd.font-mono").first()).toBeVisible();
    expect(await breiteUeberschuss(page)).toBeLessThanOrEqual(0);
    expect((await axe(page)).violations).toEqual([]);
  });
});

test("Suchfeld im Archiv zeigt den Fokus am Rand", async ({ page }) => {
  await page.goto("/archiv");
  const such = page.getByRole("searchbox");
  const label = page.locator("label").filter({ has: such });
  const rand = () => label.evaluate((el) => getComputedStyle(el).borderTopColor);
  const vorher = await rand();
  await such.focus();
  await expect.poll(rand).not.toBe(vorher);
  // Kein Doppelrahmen: Das Feld selbst zeichnet keinen eigenen Ring
  expect(await such.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
});
