import { expect, test } from "@playwright/test";

test("kompakte Kacheln: mehr auf einen Blick, ohne Knöpfe, vom Browser gemerkt", async ({ page }, info) => {
  const name = `kompakt-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await page.goto("/archiv");
  await page.getByRole("button", { name: "Kompakt" }).click();
  await expect(page.getByRole("button", { name: "Kompakt" })).toHaveAttribute("aria-pressed", "true");
  // Ohne Darstellung in der Adresse merkt sie sich der Browser; nach dem Neuladen bleibt sie
  await page.reload();
  await expect(page.getByRole("button", { name: "Kompakt" })).toHaveAttribute("aria-pressed", "true");
  const karte = page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(karte).toBeVisible();
  await expect(karte.getByRole("link", { name: "Öffnen" })).toBeHidden();
});
