import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";

const axe = (page: Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function axeHellUndDunkel(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
}

/** Ein echtes PDF mit Text auf jeder Seite; die erste Seite optional gedreht */
async function pdf(text: string, seiten = 1, drehung = 0) {
  const doc = await PDFDocument.create();
  // Jedes PDF eine eigene Datei, auch bei gleichem Text: Dieselbe nimmt Belegt nur einmal auf
  doc.setSubject(randomUUID());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= seiten; i++) {
    const seite = doc.addPage();
    seite.drawText(`${text} Seite ${i}`, { x: 50, y: 700, size: 18, font });
    if (i === 1 && drehung) seite.setRotation(degrees(drehung));
  }
  return Buffer.from(await doc.save());
}

async function hochladen(page: Page, name: string, buffer: Buffer) {
  await page.goto("/archiv");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer });
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!.split("/").pop()!;
}

test("Vorschaubild in der Liste und als Kacheln", async ({ page }, info) => {
  const name = `vorschau-${info.project.name}.pdf`;
  await hochladen(page, name, await pdf("Vorschau"));
  const zeile = page.getByRole("row", { name: new RegExp(name) });
  // Der Worker (hier der E2E-Server) erzeugt das Bild kurz nach dem Hochladen; die Liste lädt es beim nächsten Abruf
  await expect(async () => {
    await page.reload();
    await expect(zeile.getByTestId("vorschaubild")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect
    .poll(() => zeile.getByTestId("vorschaubild").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(300);
  await axeHellUndDunkel(page);

  await page.getByRole("button", { name: "Kacheln" }).click();
  await expect(page.getByRole("button", { name: "Kacheln" })).toHaveAttribute("aria-pressed", "true");
  const kachel = page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(kachel.getByTestId("vorschaubild")).toBeVisible();
  await axeHellUndDunkel(page);
  // Der Browser merkt sich die Wahl
  await page.reload();
  await expect(page.getByRole("button", { name: "Kacheln" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Liste" }).click();
  await expect(zeile).toBeVisible();
});

test("Seite drehen legt ein neues Dokument mit Verweis auf das Original an", async ({ page }, info) => {
  const name = `drehen-${info.project.name}.pdf`;
  const id = await hochladen(page, name, await pdf("Drehen", 2));
  await page.getByRole("link", { name, exact: true }).click();
  const seiten = page.getByRole("region", { name: "Seiten" });
  await expect(seiten).toContainText("Das Original bleibt unverändert");
  await expect(seiten.getByRole("img", { name: "Seite 2" })).toBeVisible();
  await seiten.getByRole("button", { name: "Seite 2 drehen" }).click();
  await axeHellUndDunkel(page);
  await seiten.getByRole("button", { name: "Gedreht als neues Dokument" }).click();
  const neu = seiten.getByRole("status").getByRole("link", { name: `drehen-${info.project.name} (gedreht).pdf` });
  // pdf-lib läuft in einem eigenen Prozess; neben den Seitenbildern und dem Worker dauert das etwas
  await expect(neu).toBeVisible({ timeout: 20_000 });
  await neu.click();

  const ableitungen = page.getByRole("region", { name: "Ableitungen" });
  await expect(ableitungen).toContainText("Abgeleitet aus");
  await expect(ableitungen).toContainText("Seiten gedreht");
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText("Abgeleitet aus einem anderen Dokument");
  await axeHellUndDunkel(page);
  await ableitungen.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/dokumente/${id}$`));
  await expect(page.getByRole("region", { name: "Ableitungen" })).toContainText("Daraus abgeleitet");
});

test("Zusammenfügen über die Mehrfachauswahl, in gewählter Reihenfolge", async ({ page }, info) => {
  const erstes = `teil-a-${info.project.name}.pdf`;
  const zweites = `teil-b-${info.project.name}.pdf`;
  await hochladen(page, erstes, await pdf("A"));
  await hochladen(page, zweites, await pdf("B", 2));
  await page.getByRole("checkbox", { name: `${erstes} auswählen` }).check();
  await page.getByRole("checkbox", { name: `${zweites} auswählen` }).check();
  const bereich = page.getByRole("region", { name: "Zusammenfügen" });
  await expect(bereich.getByRole("listitem")).toHaveText([zweites, erstes].map((n) => new RegExp(n)));
  await bereich.getByRole("button", { name: `${erstes} nach oben` }).click();
  await expect(bereich.getByRole("listitem")).toHaveText([erstes, zweites].map((n) => new RegExp(n)));
  await axeHellUndDunkel(page);
  await bereich.getByRole("button", { name: "2 PDFs zusammenfügen" }).click();
  const neu = `teil-a-${info.project.name} (zusammengefügt).pdf`;
  await expect(page.getByRole("status").filter({ hasText: neu })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: neu }).click();
  const ableitungen = page.getByRole("region", { name: "Ableitungen" });
  await expect(ableitungen.getByRole("link")).toHaveText([erstes, zweites]);
  await expect(page.getByRole("region", { name: "Seiten" }).getByRole("img")).toHaveCount(3);
});

test("Mehrere Dokumente als ZIP herunterladen", async ({ page }, info) => {
  const erstes = `zip-a-${info.project.name}.pdf`;
  const zweites = `zip-b-${info.project.name}.pdf`;
  const inhalt = await pdf("ZIP A");
  await hochladen(page, erstes, inhalt);
  await hochladen(page, zweites, await pdf("ZIP B"));
  await page.getByRole("checkbox", { name: `${erstes} auswählen` }).check();
  await page.getByRole("checkbox", { name: `${zweites} auswählen` }).check();
  const link = page.getByRole("link", { name: /^2 als ZIP herunterladen/ });
  await axeHellUndDunkel(page);
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^belegt-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const namen = Object.keys(zip);
  expect(namen).toEqual([
    expect.stringMatching(new RegExp(`^ASN\\d{4,}-\\d{4}-\\d{2}-\\d{2}-zip-b-${info.project.name}\\.pdf$`)),
    expect.stringMatching(new RegExp(`^ASN\\d{4,}-\\d{4}-\\d{2}-\\d{2}-zip-a-${info.project.name}\\.pdf$`)),
  ]);
  expect(Buffer.from(zip[namen[1]!]!).equals(inhalt)).toBe(true);
});

test("Notiz anlegen und über die Suche finden", async ({ page }, info) => {
  const name = `notiz-${info.project.name}.pdf`;
  const wort = `Lieferschein${info.project.name}fehlt`;
  await hochladen(page, name, await pdf("Notiz"));
  await page.getByRole("link", { name, exact: true }).click();
  const notizen = page.getByRole("region", { name: "Notizen" });
  await expect(notizen).toContainText("Noch keine Notizen.");
  await notizen.getByLabel("Neue Notiz").fill(`Beim Lieferanten nachgefragt: ${wort}`);
  await notizen.getByRole("button", { name: "Notiz hinzufügen" }).click();
  await expect(notizen.getByRole("listitem")).toContainText(wort);
  await expect(notizen.getByRole("listitem")).toContainText("nutzer:");
  await expect(page.getByRole("region", { name: "Verlauf" })).toContainText("Notiz hinzugefügt");
  await axeHellUndDunkel(page);

  await page.goto("/archiv");
  await page.getByRole("searchbox").fill(wort);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2);
});

test("ähnliche Dokumente stehen auf der Seite des Dokuments", async ({ page }, info) => {
  const p = info.project.name;
  const text = `Wartungsvertrag Heizungsanlage${p} Kesselprüfung${p} Brennwerttechnik${p}`;
  const erstes = `wartung-1-${p}.pdf`;
  const zweites = `wartung-2-${p}.pdf`;
  await hochladen(page, erstes, await pdf(text));
  const id = await hochladen(page, zweites, await pdf(text));
  // Der Text kommt aus dem gelesenen PDF; der E2E-Server liest ihn kurz nach dem Hochladen
  await expect
    .poll(async () => (await (await page.request.get(`/api/dokumente/${id}/aehnliche`)).json()).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await page.goto(`/dokumente/${id}`);
  const aehnliche = page.getByRole("region", { name: "Ähnliche Dokumente" });
  await expect(aehnliche.getByRole("link", { name: erstes, exact: true })).toBeVisible();
  await axeHellUndDunkel(page);
});

test("ein frisch angelegter Freigabelink bleibt nicht beim Wechsel zu einem anderen Dokument stehen", async ({
  page,
}, info) => {
  const p = info.project.name;
  const text = `Mietvertrag Gartenhaus${p} Schlüsselübergabe${p} Kaution${p}`;
  const erstes = `miete-1-${p}.pdf`;
  await hochladen(page, erstes, await pdf(text));
  const id = await hochladen(page, `miete-2-${p}.pdf`, await pdf(text));
  await expect
    .poll(async () => (await (await page.request.get(`/api/dokumente/${id}/aehnliche`)).json()).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  await page.goto(`/dokumente/${id}`);
  const teilen = page.getByRole("region", { name: "Teilen per Link" });
  await teilen.getByRole("button", { name: "Link anlegen" }).click();
  await expect(teilen.getByTestId("einmalwert")).toBeVisible();
  await page
    .getByRole("region", { name: "Ähnliche Dokumente" })
    .getByRole("link", { name: erstes, exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: erstes })).toBeVisible();
  await expect(page.getByTestId("einmalwert")).toHaveCount(0);
});
