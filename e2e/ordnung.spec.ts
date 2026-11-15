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

test("Tag-Filter: alle gewählten oder mindestens einer", async ({ page }, info) => {
  const projekt = info.project.name;
  const [erstes, zweites] = [`Modus-A-${projekt}.pdf`, `Modus-B-${projekt}.pdf`];
  await hochladen(page, erstes);
  await hochladen(page, zweites);
  const r = page.request;
  const liste = (await (await r.get("/api/dokumente?limit=200")).json()) as { id: string; dateiname: string }[];
  const id = (name: string) => liste.find((d) => d.dateiname === name)!.id;
  const tagA = (await (await r.post("/api/tags", { data: { name: `Modus A ${projekt}` } })).json()) as { id: string };
  const tagB = (await (await r.post("/api/tags", { data: { name: `Modus B ${projekt}` } })).json()) as { id: string };
  await r.post(`/api/dokumente/${id(erstes)}/ordnung`, { data: { tagsHinzu: [tagA.id] } });
  await r.post(`/api/dokumente/${id(zweites)}/ordnung`, { data: { tagsHinzu: [tagB.id] } });

  await page.goto("/archiv");
  await page.getByRole("button", { name: `Modus A ${projekt}` }).click();
  await page.getByRole("button", { name: `Modus B ${projekt}` }).click();
  await expect(page.getByRole("button", { name: "alle", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: erstes })).toHaveCount(0);
  await page.getByRole("button", { name: "mindestens einer" }).click();
  await expect(page.getByRole("link", { name: erstes })).toBeVisible();
  await expect(page.getByRole("link", { name: zweites })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
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

test("Mehrfachauswahl: alle auf der Seite wählen und in einem Schritt einen Tag hinzufügen", async ({ page }, info) => {
  const tag = `Stapel ${info.project.name}`;
  const praefix = `Stapel-${info.project.name}`;
  await hochladen(page, `${praefix}-1.pdf`);
  await hochladen(page, `${praefix}-2.pdf`);
  await page.goto("/ordnung");
  const tags = page.locator("section", { has: page.getByRole("heading", { name: "Tags", exact: true }) });
  await tags.getByLabel("Neuer Tag").fill(tag);
  await tags.getByRole("button", { name: "Tag anlegen" }).click();
  await expect(tags.getByRole("listitem").filter({ hasText: tag })).toBeVisible();

  await page.goto("/archiv");
  await page.getByRole("searchbox").fill(praefix);
  await expect(page.getByRole("link", { name: `${praefix}-1.pdf` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${praefix}-2.pdf` })).toBeVisible();
  await page.getByRole("checkbox", { name: "Alle auf dieser Seite auswählen" }).check();
  const sammel = page.locator("section", { has: page.getByRole("heading", { name: "2 gewählt" }) });
  await sammel.getByRole("combobox", { name: "Aktion" }).selectOption("tagsHinzu");
  await sammel.getByRole("combobox", { name: "Tag" }).selectOption({ label: tag });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
  await sammel.getByRole("button", { name: "Auf 2 anwenden" }).click();
  await expect(page.getByRole("status")).toContainText("2 Dokumente geändert");
  await expect(page.getByRole("checkbox", { name: "Alle auf dieser Seite auswählen" })).not.toBeChecked();
  for (const n of [1, 2])
    await expect(page.getByRole("row", { name: new RegExp(`${praefix}-${n}`) })).toContainText(tag);
});
