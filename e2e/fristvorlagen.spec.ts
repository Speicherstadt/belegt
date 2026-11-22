import { expect, test } from "@playwright/test";

test("eigene Fristvorlage anlegen und beim Einordnen als „freiwillig mit Frist“ nutzen", async ({ page }, info) => {
  const p = info.project.name;
  const vorlage = `Garantie ${p}`;
  await page.goto("/fristen");
  const karte = page.getByRole("region", { name: "Eigene Fristvorlagen" });
  await karte.getByRole("button", { name: "+ Vorlage anlegen" }).click();
  await karte.getByLabel("Name").fill(vorlage);
  await karte.getByLabel("Dauer in Monaten").fill("24");
  await karte.getByRole("button", { name: "Vorlage anlegen", exact: true }).click();
  await expect(karte.getByRole("listitem").filter({ hasText: vorlage })).toContainText("24 Monate ab Entstehung");

  const name = `garantie-${p}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await page.getByRole("link", { name }).click();
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await einordnung.getByLabel("Art").selectOption("freiwillig");
  await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2026-03-15");
  await einordnung.getByLabel("Vorlage").selectOption({ label: `${vorlage} (24 Monate)` });
  await expect(einordnung.getByLabel("Aufbewahren bis")).toHaveValue("2028-03-15");
});
