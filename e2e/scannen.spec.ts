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
  await expect(zeile.getByRole("cell").first()).toHaveText(asn!);
  await page.getByLabel(SUCHE).fill(`ASN ${asn}`);
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(link).toBeVisible();
  await ohneVerstoesse(page);
});
