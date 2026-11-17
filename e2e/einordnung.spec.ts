import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const axe = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("ein Dokument aus dem Eingang einordnen: Frist nach § 147 AO, danach im Archiv unter Pflicht", async ({
  page,
}, info) => {
  const name = `Telefon-${info.project.name}.pdf`;
  const titel = `Telefon März (${info.project.name})`;
  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await page.getByRole("link", { name }).click();

  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await expect(einordnung).toContainText("Noch nicht eingeordnet");
  // Offen: Die Einordnung steht als erste Karte der rechten Spalte, vor allen anderen
  const spalte = einordnung.locator("..");
  await expect(spalte.locator("> section").first()).toHaveAttribute("aria-labelledby", "einordnung");
  expect((await axe(page)).violations).toEqual([]);
  await einordnung.getByLabel("Art").selectOption("beleg");
  await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2026-03-15");
  await einordnung.getByLabel("Titel (optional)").fill(titel);
  await einordnung.getByRole("button", { name: "Einordnen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: titel })).toBeVisible();
  await expect(einordnung).toContainText("Buchungsbelege");
  // Eingeordnet: Die Reihenfolge der Karten ist wieder die übliche, die Einordnung steht nicht mehr zuerst
  await expect(spalte.locator("> section").first()).not.toHaveAttribute("aria-labelledby", "einordnung");
  await expect(einordnung).toContainText("31.12.2034");
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Verlauf" }) })).toContainText(
    "Eingeordnet",
  );

  await page.goto("/eingang");
  await expect(page.getByRole("link", { name: titel })).toHaveCount(0);

  await page.goto("/archiv");
  await page.getByRole("button", { name: "Pflicht" }).click();
  const zeile = page.getByRole("row", { name: new RegExp(titel.replace(/[()]/g, "\\$&")) });
  await expect(zeile).toContainText("Buchungsbelege, bis 31.12.2034");
  await page.getByRole("button", { name: "Frei", exact: true }).click();
  await expect(page.getByRole("link", { name: titel })).toHaveCount(0);
});

test("Sperren anlegen und aufheben", async ({ page }, info) => {
  const grund = `Betriebsprüfung ${info.project.name}`;
  await page.goto("/fristen");
  await expect(page.getByText("Im Archiv", { exact: true })).toBeVisible();
  const sperren = page.locator("section", { has: page.getByRole("heading", { name: "Sperren" }) });
  await sperren.getByLabel("Grund").fill(grund);
  await sperren.getByLabel("Von").fill("2022-01-01");
  await sperren.getByLabel("Bis").fill("2024-12-31");
  await sperren.getByRole("button", { name: "Sperre anlegen" }).click();
  const eintrag = sperren.getByRole("listitem").filter({ hasText: grund });
  await expect(eintrag).toContainText("aktiv");
  expect((await axe(page)).violations).toEqual([]);
  await eintrag.getByRole("button", { name: "Aufheben" }).click();
  await expect(eintrag).toContainText("aufgehoben am");
});

test("der Vorschlag des Sprachmodells füllt die Einordnung vor, eingeordnet wird erst beim Bestätigen", async ({
  page,
}, info) => {
  const name = `ki-angebot-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(`Unser Angebot (${info.project.name})`) });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  await expect
    .poll(async () => (await (await page.request.get(`/api/dokumente/${id}/vorschlag`)).json()).ki?.art)
    .toBe("geschaeftsbrief");

  await link.click();
  const hinweis = page.getByText("Vorschlag des Sprachmodells (e2e-modell): Handels- und Geschäftsbriefe.", {
    exact: false,
  });
  await expect(hinweis).toBeVisible();
  await expect(page.getByText("Noch nicht eingeordnet", { exact: false }).first()).toBeVisible();
  await hinweis.locator("..").getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByLabel("Entstanden, empfangen oder abgesandt am")).toHaveValue("2026-09-15");
  await expect(page.getByLabel("Titel (optional)")).toHaveValue("Angebot Werkstatt");
  await expect(page.getByLabel("Korrespondent (optional)")).toHaveValue("Werkstatt Beispiel");
  await page.getByRole("button", { name: "Einordnen" }).click();
  await expect(page.getByText("31.12.2032").first()).toBeVisible();
});
