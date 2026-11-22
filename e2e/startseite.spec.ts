import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("die Startseite zeigt Zahlen mit Beschriftung und Kacheln aus einer gespeicherten Ansicht", async ({
  page,
}, info) => {
  const name = `Kachel-${info.project.name}.pdf`;
  const ansicht = `Kachel ${info.project.name}`;
  await page.goto("/eingang");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.goto("/");
  const ueberblick = page.getByRole("region", { name: "Überblick" });
  for (const beschriftung of [
    "Im Eingang, noch nicht eingeordnet",
    "Dokumente im Archiv",
    "In diesem Jahr eingegangen",
    "Offene Löschanträge",
    "Aktive Sperren",
    "Speicher für Originale",
  ])
    await expect(ueberblick.getByRole("term").filter({ hasText: beschriftung })).toBeVisible();
  // Mindestens das eben hochgeladene Dokument liegt im Eingang
  const eingang = ueberblick.locator("dl > div").filter({ hasText: "Im Eingang, noch nicht eingeordnet" });
  await expect(eingang.getByRole("definition").first()).toHaveText(/^[1-9]\d*$/);
  await expect(page.getByRole("region", { name: "Fristen der nächsten 90 Tage" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Quellen" })).toBeVisible();
  // Die Startseite zeigt den letzten gespeicherten Lauf; der Inhaber prüft auf Wunsch sofort
  const kette = page.getByRole("region", { name: "Unveränderbarkeit" });
  await kette.getByRole("button", { name: "Jetzt prüfen" }).click();
  await expect(kette).toContainText("in Ordnung");
  await expect(kette.getByRole("definition").nth(1)).toHaveText(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}, \d+ Einträge$/);

  // Eine Ansicht speichern und als Kachel wählen
  await page.goto("/archiv");
  await page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" }).fill(name);
  await page.getByRole("button", { name: "Ansicht speichern" }).click();
  await page.getByLabel("Name der Ansicht").fill(ansicht);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: ansicht })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Kacheln wählen" }).click();
  await page.getByRole("checkbox", { name: ansicht }).check();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const kachel = page.getByRole("region", { name: ansicht });
  await expect(kachel).toContainText("1 Dokument");
  await expect(kachel.getByRole("link", { name })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
  await kachel.getByRole("link", { name: `Alle in „${ansicht}“` }).click();
  await expect(
    page.getByRole("searchbox", { name: "Volltext in Dokumenten, Mails und Anhängen oder ASN" }),
  ).toHaveValue(name);
});
