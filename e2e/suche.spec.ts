import { expect, test } from "@playwright/test";

test("Suche in der Kopfzeile: Vorschläge beim Tippen, Enter führt ins Archiv", async ({ page }, info) => {
  const name = `kopfsuche-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.goto("/fristen");
  await page.keyboard.press("/");
  const feld = page.getByRole("searchbox", { name: "Suche in allen Dokumenten" });
  await expect(feld).toBeFocused();
  await feld.fill(`kopfsuche-${info.project.name}`);
  const treffer = page.getByRole("list", { name: "Treffer" });
  await expect(treffer.getByRole("link", { name })).toBeVisible();
  await feld.press("Enter");
  await expect(page).toHaveURL(/\/archiv\?suche=kopfsuche/);
});
