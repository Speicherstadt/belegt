import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Ein eingeordnetes Dokument; seine Seite zeigt ASN, Art und Siegel */
async function eingeordnetesDokument(page: Page, name: string) {
  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await page.getByRole("link", { name }).click();
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await einordnung.getByLabel("Art").selectOption("beleg");
  await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2026-03-15");
  await einordnung.getByRole("button", { name: "Einordnen", exact: true }).click();
  await expect(einordnung).toContainText("Buchungsbelege");
}

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

test("ASN und Art auf der Dokumentseite klappen auf, ohne die Begriffsspalte zu verbreitern", async ({
  page,
}, info) => {
  await eingeordnetesDokument(page, `Erklaerung-${info.project.name}.pdf`);
  // Breite der Begriffsspalte: Abstand des Werts vom linken Rand der Liste (unabhängig von einer Scrollleiste)
  const spalte = () =>
    page
      .locator("dd[class*=flex]", { has: page.getByTestId("asn") })
      .evaluate((e) => e.getBoundingClientRect().left - e.parentElement!.getBoundingClientRect().left);
  const breite = await spalte();
  // Eine Zeile ohne Knopf hat denselben Wertabstand wie die ASN-Zeile mit Knopf
  const ohneKnopf = page.getByText("Eingegangen", { exact: true }).locator("xpath=following-sibling::dd[1]");
  expect(
    await ohneKnopf.evaluate((e) => e.getBoundingClientRect().left - e.parentElement!.getBoundingClientRect().left),
  ).toBe(breite);

  for (const [begriff, satz] of [
    ["ASN", "Die Archivnummer ist eine fortlaufende Nummer"],
    ["Art", "Die Art sagt, wie lange ein Dokument bleiben muss"],
    ["Siegel", "Das Siegel ist ein Fingerabdruck"],
  ] as const) {
    // Das Siegel steht im Reiter „Verlauf“
    if (begriff === "Siegel") await page.getByRole("tab", { name: "Verlauf" }).click();
    const knopf = page.getByRole("button", { name: `Was ist „${begriff}“?` });
    await expect(knopf).toHaveAttribute("aria-expanded", "false");
    // Per Tastatur: Auf dem Handy ragt die Dokumentseite heute seitlich heraus und verdeckt Ziele für den Mauszeiger
    await knopf.focus();
    await page.keyboard.press("Enter");
    await expect(knopf).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(satz)).toBeVisible();
    // ASN und Art stehen im Reiter „Einordnung“: Die Spalte bleibt so breit wie vorher
    if (begriff !== "Siegel") expect(await spalte()).toBe(breite);
  }
});

test("der Satz schiebt Inhalt nach unten, aber nicht zur Seite, auch auf dem Handy", async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const knopf = page.getByRole("button", { name: "Was ist „Hash-Kette“?" });
  await expect(knopf).toBeVisible();
  const zeile = knopf.locator("xpath=ancestor::dt");
  // Seitenkoordinate: Der Klick darf die Seite scrollen, ohne dass die Zeile als verschoben gilt
  const oben = (e: Element) => e.getBoundingClientRect().top + window.scrollY;
  const davor = await zeile.evaluate(oben);
  const ziel = await knopf.boundingBox();
  // Am Handy (Touch) 44 px, am Desktop 40 px
  const mindest = info.project.name === "handy" ? 44 : 40;
  expect(ziel!.width).toBeGreaterThanOrEqual(mindest);
  expect(ziel!.height).toBeGreaterThanOrEqual(mindest);

  await knopf.click();
  const satz = page.getByText("Jeder Eintrag im Protokoll enthält den Fingerabdruck");
  await expect(satz).toBeVisible();
  // Die Zeile mit dem Begriff bleibt, wo sie war; der Satz steht darunter
  expect(await zeile.evaluate(oben)).toBe(davor);
  expect(await satz.evaluate(oben)).toBeGreaterThan(davor);
  expect(await satz.evaluate((e) => getComputedStyle(e).fontSize)).toBe("16px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
