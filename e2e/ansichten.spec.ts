import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { menueOeffnen } from "./menue.ts";

const axe = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("Suche und Filter als Ansicht speichern und über die Seitenleiste wieder öffnen", async ({ page }, info) => {
  const name = `Ansicht-${info.project.name}.pdf`;
  const ansicht = `Meine Suche ${info.project.name}`;
  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.goto("/archiv");
  await page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" }).fill(name);
  await page.getByRole("button", { name: "Im Eingang", exact: true }).click();
  await page.getByLabel("Sortierung").selectOption({ label: "Zuerst eingegangen" });
  await expect(page).toHaveURL(/sortierung=alt/);
  await expect(page).toHaveURL(/gruppe=offen/);
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.getByRole("button", { name: "Ansicht speichern" }).click();
  await page.getByLabel("Name der Ansicht").fill(ansicht);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `Gespeicherte Ansicht: ${ansicht}` })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }

  // Ohne Filter ins Archiv, dann über die Ansicht in der Seitenleiste zurück
  await page.goto("/archiv");
  await expect(
    page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" }),
  ).toHaveValue("");
  await menueOeffnen(page);
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  if (info.project.name === "handy") await nav.scrollIntoViewIfNeeded();
  await menueOeffnen(page);
  await nav.getByRole("link", { name: ansicht }).click();
  await expect(
    page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" }),
  ).toHaveValue(name);
  await expect(page.getByLabel("Sortierung")).toHaveValue("alt");
  await expect(page.getByRole("button", { name: "Im Eingang", exact: true })).toHaveAttribute("aria-pressed", "true");
  await menueOeffnen(page);
  await expect(nav.getByRole("link", { name: ansicht })).toHaveAttribute("aria-current", "page");
  await menueOeffnen(page);
  await expect(nav.getByRole("link", { name: "Archiv", exact: true })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name })).toBeVisible();

  // Die Adresse allein reicht: neu laden zeigt dieselbe Ansicht
  await page.reload();
  await expect(
    page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" }),
  ).toHaveValue(name);

  // Umbenennen und löschen
  await page.getByText("Eigene Ansichten verwalten").click();
  await page.getByRole("button", { name: `Ansicht „${ansicht}“ umbenennen` }).click();
  await page.getByRole("textbox", { name: "Name der Ansicht" }).fill(`${ansicht} neu`);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await menueOeffnen(page);
  await expect(nav.getByRole("link", { name: `${ansicht} neu` })).toBeVisible();
  await page.getByRole("button", { name: `Ansicht „${ansicht} neu“ löschen` }).click();
  await menueOeffnen(page);
  await expect(nav.getByRole("link", { name: `${ansicht} neu` })).toHaveCount(0);
});
