import { expect, test } from "@playwright/test";

test("Tag, Korrespondent und Dokumenttyp direkt im Dokument anlegen und setzen", async ({ page }, info) => {
  const p = info.project.name;
  const name = `schnell-${p}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await page.getByRole("link", { name }).click();
  const ordnung = page.locator("section", { has: page.getByRole("heading", { name: "Ordnung", exact: true }) });

  await ordnung.getByRole("button", { name: "+ Neu: Tag" }).click();
  await ordnung.getByLabel("Name für neu: Tag").fill(`Schnelltag ${p}`);
  await ordnung.getByRole("button", { name: "Anlegen und setzen" }).click();
  await expect(ordnung.getByRole("list", { name: "Tags" })).toContainText(`Schnelltag ${p}`);

  await ordnung.getByRole("button", { name: "+ Neu: Korrespondent" }).click();
  await ordnung.getByLabel("Name für neu: Korrespondent").fill(`Schnell GmbH ${p}`);
  await ordnung.getByRole("button", { name: "Anlegen und setzen" }).click();
  await expect(
    ordnung.getByRole("combobox", { name: "Korrespondent", exact: true }).locator("option:checked"),
  ).toHaveText(`Schnell GmbH ${p}`);

  await ordnung.getByRole("button", { name: "+ Neu: Dokumenttyp" }).click();
  await ordnung.getByLabel("Name für neu: Dokumenttyp").fill(`Schnelltyp ${p}`);
  await ordnung.getByRole("button", { name: "Anlegen und setzen" }).click();
  await expect(
    ordnung.getByRole("combobox", { name: "Dokumenttyp", exact: true }).locator("option:checked"),
  ).toHaveText(`Schnelltyp ${p}`);
});
