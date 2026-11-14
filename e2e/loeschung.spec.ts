import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("nach Fristende: Inhaber beantragt, die Steuerberatung bestätigt, übrig bleibt der Löschnachweis", async ({
  page,
  browser,
}, info) => {
  const name = `Beleg-2017-${info.project.name}.pdf`;
  await page.goto("/");
  await page
    .getByTestId("upload")
    .setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) });
  await page.getByRole("link", { name }).click();
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await einordnung.getByLabel("Art").selectOption("beleg");
  await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2017-05-10");
  await einordnung.getByRole("button", { name: "Einordnen" }).click();

  const loeschung = page.locator("section", { has: page.getByRole("heading", { name: "Löschung", exact: true }) });
  await expect(loeschung).toContainText("§ 147 Abs. 3 Satz 5 AO");
  await loeschung.getByRole("button", { name: "Löschung beantragen" }).click();
  await expect(loeschung).toContainText("Eine zweite Person bestätigt.");
  await expect(loeschung.getByRole("button", { name: "Löschung bestätigen" })).toHaveCount(0);
  const dokumentUrl = page.url();

  await page.goto("/zugaenge");
  await page.getByLabel("Rolle").selectOption("steuerberatung");
  await page.getByRole("button", { name: "Einladen" }).click();
  const link = await page.getByRole("status").locator("code").textContent();

  const fremd = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });
  const kanzlei = await fremd.newPage();
  try {
    await kanzlei.goto(link!);
    await kanzlei.getByLabel("E-Mail-Adresse").fill(`zweite-${info.project.name}@example.org`);
    await kanzlei.getByLabel("Passwort").fill("ein-langes-kanzlei-passwort");
    await kanzlei.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(kanzlei.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
    await kanzlei.goto("/fristen");
    const offen = kanzlei.locator("section", { has: kanzlei.getByRole("heading", { name: "Offene Löschungen" }) });
    const antrag = offen.getByRole("listitem").filter({ hasText: name });
    const axe = await new AxeBuilder({ page: kanzlei })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await antrag.getByRole("button", { name: "Löschung bestätigen" }).click();
    await expect(antrag).toHaveCount(0);
  } finally {
    await fremd.close();
  }

  await page.goto(dokumentUrl);
  await expect(
    page.locator("section", { has: page.getByRole("heading", { name: "Löschung", exact: true }) }),
  ).toContainText("Gelöscht am");
  await expect(page.getByRole("link", { name: "Original herunterladen" })).toHaveCount(0);
  await page.goto("/archiv");
  await expect(page.getByRole("link", { name })).toHaveCount(0);
  await page.getByRole("button", { name: "Gelöscht", exact: true }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});
