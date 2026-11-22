import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Workflow anlegen und seine Wirkung bei einem Upload sehen", async ({ page }, info) => {
  const tag = `Workflow-Tag ${info.project.name}`;
  const workflow = `Rechnungen taggen ${info.project.name}`;
  const kennung = `wf-${info.project.name}`;
  const name = `${kennung}-rechnung.pdf`;

  await page.goto("/ordnung?bereich=tags");
  const tags = page.locator("section", { has: page.getByRole("heading", { name: "Tags", exact: true }) });
  await tags.getByLabel("Neuer Tag").fill(tag);
  await tags.getByRole("button", { name: "Tag anlegen" }).click();
  await expect(tags.getByRole("listitem").filter({ hasText: tag })).toBeVisible();

  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
  const neu = page.getByRole("region", { name: "Neuer Workflow" });
  await neu.getByRole("button", { name: "+ Neuer Workflow" }).click();
  await neu.getByLabel("Name", { exact: true }).fill(workflow);
  await neu.getByRole("checkbox", { name: "Hochgeladen" }).check();
  await neu.getByRole("combobox", { name: "Bedingung hinzufügen" }).selectOption({ label: "Dateiname enthält" });
  await neu.getByLabel("Dateiname enthält", { exact: true }).fill(kennung);
  const aktion = neu.getByRole("combobox", { name: "Aktion hinzufügen" });
  await aktion.selectOption({ label: "Tag hinzufügen" });
  await neu.getByLabel("Tag hinzufügen", { exact: true }).selectOption({ label: tag });
  await aktion.selectOption({ label: "Notiz anlegen" });
  await neu.getByLabel("Notiz anlegen", { exact: true }).fill("Vom Workflow getaggt");
  // Was man wieder entfernt, steht nicht mehr im Formular
  await aktion.selectOption({ label: "Tag entfernen" });
  await neu.getByRole("button", { name: "Tag entfernen entfernen" }).click();
  await expect(neu.getByLabel("Tag entfernen", { exact: true })).toHaveCount(0);
  await neu.getByRole("button", { name: "Workflow anlegen" }).click();
  const eintrag = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: workflow }) });
  await expect(eintrag).toContainText("Dokument aufgenommen");
  await expect(eintrag).toContainText(`Dateiname enthält „${kennung}“`);
  await expect(eintrag).toContainText(`Tag ${tag} hinzufügen`);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }

  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await page.getByRole("link", { name }).click();
  // Der Worker führt den Workflow kurz nach dem Eingang aus
  const ordnung = page.locator("section", { has: page.getByRole("heading", { name: "Ordnung", exact: true }) });
  await expect(async () => {
    await page.reload();
    await expect(ordnung.getByRole("button", { name: `Tag ${tag} entfernen` })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Notizen" }).click();
  await expect(page.getByText("Vom Workflow getaggt")).toBeVisible();
  await page.getByRole("tab", { name: "Verlauf" }).click();
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Verlauf" }) })).toContainText(
    `workflow:${workflow}`,
  );

  await page.goto("/workflows");
  const laeufe = page.getByRole("region", { name: "Letzte Läufe" });
  await expect(laeufe.getByRole("row", { name: new RegExp(name) })).toContainText("ausgeführt");
  // Ausschalten und löschen
  await page.getByRole("button", { name: `Workflow „${workflow}“ ausschalten` }).click();
  await expect(eintrag).toContainText("(aus)");
  await page.getByRole("button", { name: `Workflow „${workflow}“ löschen` }).click();
  await expect(page.getByRole("heading", { name: workflow })).toHaveCount(0);
});

test("Original an Adresse senden: Aktion anlegen, das Ergebnis steht am Dokument", async ({ page }, info) => {
  const workflow = `An Buchhaltung ${info.project.name}`;
  const kennung = `senden-${info.project.name}`;
  const name = `${kennung}.pdf`;
  await page.goto("/workflows");
  const neu = page.getByRole("region", { name: "Neuer Workflow" });
  await neu.getByRole("button", { name: "+ Neuer Workflow" }).click();
  await neu.getByLabel("Name", { exact: true }).fill(workflow);
  await neu.getByRole("combobox", { name: "Bedingung hinzufügen" }).selectOption({ label: "Dateiname enthält" });
  await neu.getByLabel("Dateiname enthält", { exact: true }).fill(kennung);
  await neu.getByRole("checkbox", { name: "Original an Adresse senden" }).check();
  await neu.getByLabel("Adresse (https://…)").fill("https://buchhaltung.example/api/v1/belege");
  await expect(neu.getByLabel("Name des Dateifelds")).toHaveValue("datei");
  await neu.getByLabel("Wert der Kopfzeile (wird verschlüsselt gespeichert)").fill("Bearer e2e-token");
  await neu.getByLabel("Feste Felder, je Zeile name=wert").fill("externalSource=belegt\nexternalId={id}");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
  await neu.getByRole("button", { name: "Workflow anlegen" }).click();
  const eintrag = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: workflow }) });
  await expect(eintrag).toContainText("Original an buchhaltung.example senden");
  // Das Formular schließt sich; neu geöffnet ist es leer, auch die Aktion senden
  await expect(neu.getByLabel("Name", { exact: true })).toHaveCount(0);
  await neu.getByRole("button", { name: "+ Neuer Workflow" }).click();
  await expect(neu.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(neu.getByRole("checkbox", { name: "Original an Adresse senden" })).not.toBeChecked();
  await expect(neu.getByLabel("Adresse (https://…)")).toHaveCount(0);
  // Der Wert der Kopfzeile kommt nie zurück
  expect(JSON.stringify(await (await page.request.get("/api/workflows")).json())).not.toContain("e2e-token");

  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await page.getByRole("link", { name }).click();
  await page.getByRole("tab", { name: "Weiteres" }).click();
  const weitergaben = page.getByRole("region", { name: "Weitergaben" });
  await expect(async () => {
    await page.reload();
    await expect(weitergaben).toContainText("gesendet", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(weitergaben).toContainText(`${workflow} → buchhaltung.example`);
  await expect(weitergaben).toContainText("HTTP 201");
});
