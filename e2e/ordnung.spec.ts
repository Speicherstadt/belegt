import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const axe = (page: Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function hochladen(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await expect(page.getByRole("link", { name })).toBeVisible();
}

test("Tag anlegen, einem Dokument zuweisen und im Archiv danach filtern", async ({ page }, info) => {
  const tag = `Steuer ${info.project.name}`;
  const name = `Tagged-${info.project.name}.pdf`;
  const anderes = `Ohne-Tag-${info.project.name}.pdf`;
  await hochladen(page, anderes);
  await hochladen(page, name);

  await page.goto("/ordnung");
  const tags = page.locator("section", { has: page.getByRole("heading", { name: "Tags", exact: true }) });
  await tags.getByLabel("Neuer Tag").fill(tag);
  await tags.getByRole("combobox", { name: "Farbe" }).selectOption("blau");
  await tags.getByRole("button", { name: "Tag anlegen" }).click();
  await expect(tags.getByRole("listitem").filter({ hasText: tag })).toContainText("0 Dokumente");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }

  await page.goto("/");
  await page.getByRole("link", { name }).click();
  const ordnung = page.locator("section", { has: page.getByRole("heading", { name: "Ordnung", exact: true }) });
  await ordnung.getByRole("combobox", { name: "Tag", exact: true }).selectOption({ label: tag });
  await ordnung.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(ordnung.getByRole("button", { name: `Tag ${tag} entfernen` })).toBeVisible();
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Verlauf" }) })).toContainText(
    `Tag hinzugefügt: ${tag}`,
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }

  await page.goto("/archiv");
  await expect(page.getByRole("link", { name: anderes })).toBeVisible();
  await page.getByRole("button", { name: tag }).click();
  await expect(page.getByRole("button", { name: tag })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: anderes })).toHaveCount(0);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText(tag);
  // Die Suche findet den Namen des Tags
  await page.getByRole("button", { name: tag }).click();
  await page.getByRole("searchbox").fill(`"${tag}"`);
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("link", { name: anderes })).toHaveCount(0);
});

test("ein Betragsfeld definieren, „1.234,56“ eingeben und nach Betrag filtern", async ({ page }, info) => {
  const feld = `Summe ${info.project.name}`;
  const name = `Angebot-${info.project.name}.pdf`;
  await hochladen(page, name);

  await page.goto("/ordnung");
  const felder = page.locator("section", { has: page.getByRole("heading", { name: "Eigene Felder" }) });
  await felder.getByLabel("Neues Feld").fill(feld);
  await felder.getByRole("combobox", { name: "Typ" }).selectOption("betrag");
  await felder.getByRole("button", { name: "Feld anlegen" }).click();
  await expect(felder.getByRole("listitem").filter({ hasText: feld })).toContainText("Betrag (EUR)");

  await page.goto("/");
  await page.getByRole("link", { name }).click();
  const ordnung = page.locator("section", { has: page.getByRole("heading", { name: "Ordnung", exact: true }) });
  const eingabe = ordnung.getByLabel(`${feld} (EUR)`);
  await eingabe.fill("12,345");
  await ordnung.getByRole("button", { name: `${feld} speichern` }).click();
  await expect(ordnung.getByRole("alert")).toContainText("Kein Betrag");
  await eingabe.fill("1.234,56");
  await ordnung.getByRole("button", { name: `${feld} speichern` }).click();
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Verlauf" }) })).toContainText(
    `Feld gesetzt: ${feld}`,
  );
  await expect(ordnung.getByLabel(`${feld} (EUR)`)).toHaveValue("1234,56");

  await page.goto("/archiv");
  await page.getByRole("combobox", { name: "Feld", exact: true }).selectOption({ label: `${feld} (EUR)` });
  await page.getByRole("combobox", { name: "Bedingung" }).selectOption("bereich");
  await page.getByRole("textbox", { name: "Von", exact: true }).fill("1.000,00");
  await expect(page.getByRole("link", { name })).toBeVisible();
  await page.getByRole("textbox", { name: "Von", exact: true }).fill("2.000,00");
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});
