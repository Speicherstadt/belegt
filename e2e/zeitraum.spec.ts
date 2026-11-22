import { expect, test } from "@playwright/test";

test("der Zeitraum filtert das Archiv und steht in der Adresse", async ({ page }, info) => {
  const name = `zeitraum-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.goto("/archiv");
  await page.getByRole("combobox", { name: "Zeitraum" }).selectOption({ label: "Letzte 7 Tage" });
  await page.getByRole("combobox", { name: "Datum", exact: true }).selectOption({ label: "Eingegangen" });
  await expect(page).toHaveURL(/datum=eingegangen&zeitraum=7t/);
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.getByRole("combobox", { name: "Zeitraum" }).selectOption({ label: "Letztes Jahr" });
  await expect(page.getByRole("link", { name })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Zeitraum" }).selectOption({ label: "Eigener Zeitraum" });
  await page.getByLabel("Von", { exact: true }).fill("2000-01-01");
  await expect(page).toHaveURL(/datumVon=2000-01-01/);
  await expect(page.getByRole("link", { name })).toBeVisible();
});
