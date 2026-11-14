import { expect, test } from "@playwright/test";

test("Angaben zum Betrieb füllen die Verfahrensdokumentation", async ({ page }) => {
  await page.goto("/verfahrensdoku");
  await expect(page.getByRole("heading", { level: 1, name: "Verfahrensdokumentation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "4. Unveränderbarkeit und Nachvollziehbarkeit" })).toBeVisible();

  await page.getByLabel("Name des Betriebs").fill("Muster Werkstatt");
  await page.getByLabel("Anschrift").fill("Musterweg 1, 12345 Musterstadt");
  await page.getByLabel("Verantwortlich für das Archiv").fill("Anna Muster");
  await page.getByLabel(/^Datensicherung/).fill("Nachts auf ein zweites Gerät, Wiederherstellung monatlich geprüft.");
  await page.getByLabel(/^Scannen/).fill("Es wird nicht gescannt.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();

  await expect(page.getByText("Muster Werkstatt archiviert steuerlich relevante Unterlagen")).toBeVisible();
  await expect(page.getByText("Nachts auf ein zweites Gerät", { exact: false }).last()).toBeVisible();
  await expect(page.getByText("Alle Angaben sind gemacht.")).toBeVisible();
  await expect(page.getByText(/^Fehlt:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Drucken oder als PDF sichern" })).toBeVisible();
});
