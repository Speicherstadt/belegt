import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const axe = (page: import("@playwright/test").Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

type Seite = import("@playwright/test").Page;

/** Lädt eine Datei hoch und öffnet ihre Seite; liefert die Karte „Einordnung“ und die Live-Region der Vorschau */
async function oeffnen(page: Seite, name: string) {
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await page.getByRole("link", { name }).click();
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  return {
    einordnung,
    kasten: einordnung.locator("[aria-live=polite]"),
    datum: einordnung.getByLabel("Entstanden, empfangen oder abgesandt am"),
  };
}

test("die Fristvorschau zeigt Datum, folgt der Art und warnt bei einer Sperre", async ({ page }, info) => {
  const { einordnung, kasten } = await oeffnen(page, `vorschau-${info.project.name}.txt`);
  // Die Live-Region steht von Anfang an im Formular
  await expect(kasten).toHaveCount(1);

  await einordnung.getByLabel("Art").selectOption("beleg");
  await expect(einordnung.getByLabel("Art")).toHaveAccessibleDescription(/Belege zu einer Buchung/);
  await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2026-03-12");
  await expect(kasten).toContainText("Wird aufbewahrt bis 31.12.2034, vorher nicht löschbar.");
  await expect(kasten).toContainText("8 Jahre ab Ende 2026 (§ 147 AO)");
  await expect(kasten).not.toContainText("gesperrt");
  expect((await axe(page)).violations).toEqual([]);

  await einordnung.getByLabel("Art").selectOption("geschaeftsbrief");
  await expect(kasten).toContainText("31.12.2032");

  await einordnung.getByLabel("Art").selectOption("frei");
  await expect(kasten).toContainText("Keine Frist.");
  await expect(kasten).toContainText("Du kannst es jederzeit löschen.");

  await einordnung.getByLabel("Art").selectOption("freiwillig");
  await expect(kasten).toContainText("Die Frist erscheint, sobald ein Datum da ist.");
  await einordnung.getByLabel("Aufbewahren bis").fill("2030-06-30");
  await expect(kasten).toContainText("Wird aufbewahrt bis 30.06.2030, bis dahin nicht löschbar.");
  await einordnung.getByLabel("Aufbewahren bis").fill("2026-01-01");
  await expect(kasten).toContainText("Das Datum liegt vor der Entstehung der Unterlage");
  expect((await axe(page)).violations).toEqual([]);

  // Eine offene Sperre über dem Tag: Zusatzzeile, danach aufheben, damit andere Tests unberührt bleiben
  await einordnung.getByLabel("Art").selectOption("beleg");
  const grund = `Vorschau-Sperre ${info.project.name}`;
  const sperre = await (
    await page.request.post("/api/sperren", { data: { grund, von: "2026-03-01", bis: "2026-03-31" } })
  ).json();
  try {
    await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2026-03-13");
    await einordnung.getByLabel("Art").selectOption("beleg");
    await expect(kasten).toContainText("Zusätzlich gesperrt, Löschen erst nach Aufhebung.");
    expect((await axe(page)).violations).toEqual([]);
    // Frei und gesperrt: kein „jederzeit löschen“ neben der Sperrzeile
    await einordnung.getByLabel("Art").selectOption("frei");
    await expect(kasten).toContainText("Keine Frist.");
    await expect(kasten).toContainText("Zusätzlich gesperrt");
    await expect(kasten).not.toContainText("jederzeit");
  } finally {
    await page.request.post(`/api/sperren/${sperre.id}/aufheben`);
  }
  await einordnung.getByLabel("Entstanden, empfangen oder abgesandt am").fill("2026-03-14");
  await expect(kasten).not.toContainText("gesperrt");
});

test("ohne Entstehungstag keine Frist, und beim Zurückwechseln zeigt die Vorschau, was im Feld steht", async ({
  page,
}, info) => {
  const { einordnung, kasten, datum } = await oeffnen(page, `vorschau-felder-${info.project.name}.txt`);
  await einordnung.getByLabel("Art").selectOption("beleg");
  await datum.fill("2026-03-12");
  await expect(kasten).toContainText("31.12.2034");
  await datum.fill("");
  await expect(kasten).toContainText("Die Frist erscheint, sobald ein Datum da ist.");
  await expect(kasten).not.toContainText("31.12.2034");
  // Zwischenwert beim Tippen des Jahres: keine Abfrage
  await datum.fill("0002-03-12");
  await expect(kasten).toContainText("Die Frist erscheint, sobald ein Datum da ist.");

  await datum.fill("2026-03-12");
  await einordnung.getByLabel("Art").selectOption("freiwillig");
  await einordnung.getByLabel("Aufbewahren bis").fill("2030-06-30");
  await expect(kasten).toContainText("30.06.2030");
  await einordnung.getByLabel("Art").selectOption("beleg");
  await einordnung.getByLabel("Art").selectOption("freiwillig");
  await expect(einordnung.getByLabel("Aufbewahren bis")).toHaveValue("");
  await expect(kasten).toContainText("Die Frist erscheint, sobald ein Datum da ist.");
});

test("eine Fristvorlage setzt das Datum, und die Vorschau folgt", async ({ page }, info) => {
  const vorlage = await (
    await page.request.post("/api/fristvorlagen", { data: { name: `Vorschau ${info.project.name}`, monate: 24 } })
  ).json();
  try {
    const { einordnung, kasten, datum } = await oeffnen(page, `vorschau-vorlage-${info.project.name}.txt`);
    await einordnung.getByLabel("Art").selectOption("freiwillig");
    await datum.fill("2026-03-15");
    await einordnung.getByLabel("Vorlage").selectOption({ label: `${vorlage.name} (24 Monate)` });
    await expect(einordnung.getByLabel("Aufbewahren bis")).toHaveValue("2028-03-15");
    await expect(kasten).toContainText("Wird aufbewahrt bis 15.03.2028, bis dahin nicht löschbar.");
  } finally {
    await page.request.delete(`/api/fristvorlagen/${vorlage.id}`);
  }
});

test("fällt die Abfrage aus, zeigt der Kasten einen ruhigen Satz", async ({ page }, info) => {
  const { einordnung, kasten, datum } = await oeffnen(page, `vorschau-netz-${info.project.name}.txt`);
  await einordnung.getByLabel("Art").selectOption("beleg");
  await page.route("**/api/fristen/vorschau**", (r) => r.abort());
  try {
    await datum.fill("2026-04-02");
    await expect(kasten).toContainText("Die Frist lässt sich gerade nicht anzeigen.");
    await expect(einordnung.getByRole("button", { name: "Einordnen", exact: true })).toBeEnabled();
  } finally {
    await page.unroute("**/api/fristen/vorschau**");
  }
  await datum.fill("2026-04-03");
  await expect(kasten).toContainText("31.12.2034");
});

test("während der Abfrage bleibt das letzte Ergebnis ganz stehen, ohne Mischstand", async ({ page }, info) => {
  const { einordnung, kasten, datum } = await oeffnen(page, `vorschau-misch-${info.project.name}.txt`);
  await einordnung.getByLabel("Art").selectOption("beleg");
  await datum.fill("2026-03-12");
  await expect(kasten).toContainText("8 Jahre ab Ende 2026");
  let weiter: () => void = () => {};
  const frei = new Promise<void>((r) => {
    weiter = r;
  });
  await page.route("**/api/fristen/vorschau**", async (r) => {
    await frei;
    await r.continue();
  });
  try {
    await datum.fill("2025-05-01");
    await page.waitForTimeout(600);
    await expect(kasten).toContainText("31.12.2034");
    await expect(kasten).toContainText("ab Ende 2026");
    weiter();
    await expect(kasten).toContainText("31.12.2033");
    await expect(kasten).toContainText("ab Ende 2025");
  } finally {
    weiter();
    await page.unroute("**/api/fristen/vorschau**");
  }
});
