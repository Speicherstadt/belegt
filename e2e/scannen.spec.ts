import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const SUCHE = "Volltext in Dokumenten, Mails und Anhängen oder ASN";

async function ohneVerstoesse(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page })
      .exclude("iframe")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
}

test("jedes Dokument hat eine Archivnummer, sichtbar in Liste und Dokument und auffindbar über die Suche", async ({
  page,
}, info) => {
  const name = `asn-${info.project.name}.txt`;
  await page.goto("/archiv");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  await link.click();
  const asn = (await page.getByTestId("asn").textContent())?.trim();
  expect(asn).toMatch(/^\d+$/);
  await expect(page.getByText("Archivnummer (ASN)")).toBeVisible();

  await page.goto("/archiv");
  const zeile = page.getByRole("row", { name: new RegExp(name) });
  // Eine eigene Zelle mit genau der Nummer (vor ihr steht für den Inhaber das Kästchen der Mehrfachauswahl)
  await expect(zeile.getByRole("cell", { name: asn!, exact: true })).toBeVisible();
  await page.getByLabel(SUCHE).fill(`ASN ${asn}`);
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(link).toBeVisible();
  await ohneVerstoesse(page);
});

test("unter Quellen gibt es ein Trennblatt zum Herunterladen", async ({ page }) => {
  await page.goto("/quellen?bereich=scannen");
  await expect(page.getByRole("heading", { name: "Scannen" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Trennblatt herunterladen (PDF)" }).click();
  const datei = await download;
  expect(datei.suggestedFilename()).toBe("trennblatt.pdf");
  const pdf = await readFile((await datei.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await ohneVerstoesse(page);
});
