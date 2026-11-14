import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PDF = Buffer.from("%PDF-1.7\n% erfundene Rechnung über 119,00 €\n");

test("ein hochgeladenes Original erscheint im Archiv, mit Verlauf, Nachweis und unveränderter Datei", async ({
  page,
}, info) => {
  const name = `Rechnung-${info.project.name}.pdf`;
  await page.goto("/archiv");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();

  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill(`-${info.project.name}`);
  await expect(link).toBeVisible();
  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill("gibt-es-nicht");
  await expect(page.getByText("Noch keine Dokumente")).toBeVisible();
  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill("");

  await link.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page).toHaveTitle(`${name} · Belegt`);
  const verlauf = page
    .getByRole("region", { name: "Verlauf" })
    .or(page.locator("section", { has: page.getByRole("heading", { name: "Verlauf" }) }));
  await expect(verlauf).toContainText("Eingegangen");
  await expect(verlauf).toContainText("Versiegelt");
  await expect(verlauf).toContainText("nutzer:anna@example.org");
  await expect(page.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible();

  const href = await page.getByRole("link", { name: "Original herunterladen" }).getAttribute("href");
  const datei = await page.request.get(href!);
  expect(datei.status()).toBe(200);
  expect(Buffer.from(await datei.body())).toEqual(PDF);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Die Vorschau im Frame (PDF-Ansicht des Browsers) gehört nicht zu Belegt
    const axe = await new AxeBuilder({ page })
      .exclude("iframe")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
});

test("die Prüfung meldet eine intakte Kette", async ({ page }) => {
  await page.goto("/pruefung");
  await expect(page.getByRole("status")).toHaveText("Kette intakt, alle Siegel stimmen.");
});
