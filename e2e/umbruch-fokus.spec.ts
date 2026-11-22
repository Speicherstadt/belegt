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
  await page.evaluate(() => document.fonts.ready);
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
    const name = `umbruch-${info.project.name}-${Date.now()}-${"x".repeat(70)}.pdf`;
    await page.goto("/archiv");
    await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer: await pdf("Umbruch") });
    await page.getByRole("link", { name, exact: true }).click();
    await page.getByRole("tab", { name: "Verlauf" }).click();
    await expect(page.locator("dd.font-mono").first()).toBeVisible();
    expect(await breiteUeberschuss(page)).toBeLessThanOrEqual(0);
    expect((await axe(page)).violations).toEqual([]);
  });
});

test("Suchfeld im Archiv zeigt den Fokus am Rand", async ({ page }) => {
  await page.goto("/archiv");
  const such = page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" });
  const label = page.locator("label").filter({ has: such });
  const rand = () => label.evaluate((el) => getComputedStyle(el).borderTopColor);
  const vorher = await rand();
  await such.focus();
  await expect.poll(rand).not.toBe(vorher);
  // Kein Doppelrahmen: Das Feld selbst zeichnet keinen eigenen Ring
  expect(await such.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`globale Fokusregel (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/archiv");
    // Eigene Bausteine auf der Seite, damit nichts von der Datenlage abhängt
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div id="fokus"><button>k</button><a href="#fokus">l</a><input type="checkbox" aria-label="c"><input type="text" aria-label="t" class="h-9 rounded-md border border-border bg-bg px-3"></div>',
      );
    });
    const fg = await page.evaluate(() => {
      const e = document.createElement("i");
      e.style.color = "var(--fg)";
      document.body.append(e);
      const c = getComputedStyle(e).color;
      e.remove();
      return c;
    });
    const stil = (sel: string) =>
      page.locator(sel).evaluate((el) => {
        const s = getComputedStyle(el);
        return { w: s.outlineWidth, o: s.outlineOffset, f: s.outlineColor, r: s.borderTopColor };
      });
    for (const sel of ["#fokus button", "#fokus a", "#fokus input[type=checkbox]"]) {
      await page.keyboard.press("Tab"); // zuletzt Tastatur benutzt, dann greift :focus-visible auch bei focus()
      await page.locator(sel).focus();
      expect(await stil(sel), sel).toMatchObject({ w: "2px", o: "2px", f: fg });
    }
    await page.keyboard.press("Tab");
    await page.locator("#fokus input[type=text]").focus();
    expect(await stil("#fokus input[type=text]")).toMatchObject({ w: "2px", o: "0px", f: fg, r: fg });
  });
}

// Windows-Kontrastmodus: Farben werden ersetzt, ein Rand, der nur die Farbe wechselt, zeigt dann keinen Fokus
test("Suchfeld zeigt den Fokus auch bei erzwungenen Farben", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/archiv");
  const such = page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" });
  const label = page.locator("label").filter({ has: such });
  const zustand = async () => ({
    rand: await label.evaluate((el) => getComputedStyle(el).borderTopColor),
    ring: await such.evaluate((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle === "none" ? "kein" : `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`;
    }),
  });
  const vorher = await zustand();
  await page.keyboard.press("Tab");
  await such.focus();
  await expect(such).toBeFocused();
  expect(await zustand()).not.toEqual(vorher);
});
