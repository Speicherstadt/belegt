import { expect, test } from "@playwright/test";

test("kompakte Kacheln: mehr auf einen Blick, ohne Knöpfe, gemerkt in der Adresse", async ({ page }, info) => {
  const name = `kompakt-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await page.goto("/archiv");
  await page.getByRole("button", { name: "Kompakt" }).click();
  await expect(page).toHaveURL(/darstellung=kompakt/);
  await expect(page.getByRole("button", { name: "Kompakt" })).toHaveAttribute("aria-pressed", "true");
  const karte = page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(karte).toBeVisible();
  await expect(karte.getByRole("link", { name: "Öffnen" })).toBeHidden();
});
