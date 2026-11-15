import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Workflow anlegen und seine Wirkung bei einem Upload sehen", async ({ page }, info) => {
  const tag = `Workflow-Tag ${info.project.name}`;
  const workflow = `Rechnungen taggen ${info.project.name}`;
  const kennung = `wf-${info.project.name}`;
  const name = `${kennung}-rechnung.pdf`;

  await page.goto("/ordnung");
  const tags = page.locator("section", { has: page.getByRole("heading", { name: "Tags", exact: true }) });
  await tags.getByLabel("Neuer Tag").fill(tag);
  await tags.getByRole("button", { name: "Tag anlegen" }).click();
  await expect(tags.getByRole("listitem").filter({ hasText: tag })).toBeVisible();

  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
  const neu = page.getByRole("region", { name: "Neuer Workflow" });
  await neu.getByLabel("Name", { exact: true }).fill(workflow);
  await neu.getByRole("checkbox", { name: "Hochgeladen" }).check();
  await neu.getByLabel("Dateiname enthält").fill(kennung);
  await neu.getByLabel("Tag hinzufügen").selectOption({ label: tag });
  await neu.getByLabel("Notiz anlegen").fill("Vom Workflow getaggt");
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
  await expect(page.getByText("Vom Workflow getaggt")).toBeVisible();
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
