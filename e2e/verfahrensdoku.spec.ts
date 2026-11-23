import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("Angaben zum Betrieb füllen die Verfahrensdokumentation, die sich als Markdown sichern lässt", async ({
  page,
}) => {
  await page.goto("/verfahrensdoku?bereich=dokument");
  await expect(page.getByRole("heading", { level: 1, name: "Verfahrensdokumentation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "4. Unveränderbarkeit und Nachvollziehbarkeit" })).toBeVisible();

  // Formular und fertiges Dokument stehen in eigenen Reitern
  await page.getByRole("tab", { name: "Angaben" }).click();
  await expect(page.getByRole("tab", { name: "Angaben", selected: true })).toBeVisible();

  await page.getByLabel("Name des Betriebs").fill("Muster Werkstatt");
  await page.getByLabel(/^Rechtsform/).fill("Einzelunternehmen");
  await page.getByLabel("Anschrift").fill("Musterweg 1, 12345 Musterstadt");
  await page.getByLabel(/^Verantwortlich/).fill("Anna Muster");
  await page.getByLabel(/^Ort der Aufbewahrung/).fill("Server und Sicherungen im Büro in Musterstadt.");
  await page.getByLabel(/^Betrieb des Servers/).fill("Anna Muster betreibt den Server selbst.");
  await page.getByLabel(/^Datensicherung/).fill("Nachts auf ein zweites Gerät, Wiederherstellung monatlich geprüft.");
  await page.getByLabel(/^Ablage von Schlüsseln/).fill("Im Tresor des Büros.");
  await page.getByLabel(/^Papierbelege und Scannen/).fill("Es wird nicht gescannt.");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert." })).toBeVisible();
  // Speichern wechselt den Reiter nicht; das Dokument zeigt die Angaben
  await expect(page.getByRole("tab", { name: "Angaben", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "Dokument" }).click();

  await expect(page.getByText("Muster Werkstatt archiviert steuerlich relevante Unterlagen")).toBeVisible();
  await expect(page.getByText("Nachts auf ein zweites Gerät", { exact: false }).last()).toBeVisible();
  await expect(page.getByText("Alle Angaben sind gemacht.")).toBeVisible();
  await expect(page.getByText(/^Fehlt:/)).toHaveCount(0);
  await expect(page.getByText(/^Stand .* · Belegt /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Drucken oder als PDF sichern" })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Als Markdown" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^verfahrensdokumentation-\d{4}-\d{2}-\d{2}\.md$/);
  const md = await readFile((await download.path())!, "utf8");
  expect(md.startsWith("# Verfahrensdokumentation Muster Werkstatt\n")).toBe(true);
  expect(md).toContain("· vollständig");
  expect(md).toContain("## 4\\. Unveränderbarkeit und Nachvollziehbarkeit");
  expect(md).toContain("Betrieb des Servers: Anna Muster betreibt den Server selbst.");
});
