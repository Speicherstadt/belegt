import { expect, test } from "@playwright/test";

test("Schnellmodus: mit Tasten einordnen, bis der Eingang leer ist", async ({ page }, info) => {
  const p = info.project.name;
  const namen = [`schnell-a-${p}.txt`, `schnell-b-${p}.txt`];
  await page.goto("/eingang");
  for (const name of namen)
    await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await expect(page.getByRole("link", { name: namen[1] })).toBeVisible();
  await page.getByRole("button", { name: "Schnell einordnen" }).click();
  await expect(page.getByText(/Schnellmodus: 1 bis 7/)).toBeVisible();

  // 2 = Geschäftsbriefe (zweite Art der Auswahl), Enter ordnet ein und öffnet das nächste
  const ersterTitel = await page.getByRole("heading", { level: 1 }).textContent();
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await page.keyboard.press("2");
  await expect(einordnung.getByLabel("Art")).toHaveValue("geschaeftsbrief");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(ersterTitel ?? "");
  await expect(page).toHaveURL(/schnell=1/);
});
