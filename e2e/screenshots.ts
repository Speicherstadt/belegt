import { writeFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { mitRahmen } from "./bildrahmen.ts";
import { vorbereiten } from "./screenshot-daten.ts";

/*
 * Bilder für README und Doku (docs/assets/screenshot-*.png): erfundene Firmen, Dokumente, Mails, Einordnungen, Tags,
 * Felder, Workflows und Zugänge, dann je Seite hell und dunkel mit Rahmen (bildrahmen.ts). Läuft nur mit
 * DOKU_SCREENSHOTS=1 (bun run docs:screenshots) auf eigenen Ports (playwright.config.ts), nicht in der CI.
 */

const ASSETS = "docs/assets";
const MOBIL = { width: 390, height: 844 };

let rahmenBrowser: Browser;

/** Hell und dunkel über den Schalter „Darstellung“ der App (speichert belegt.darstellung), ohne Neuladen */
async function darstellung(page: Page, modus: "Hell" | "Dunkel") {
  // Ein Klick im DOM, damit die Seite nicht zum Schalter scrollt; am Handy ist das Menü zu und der Schalter verborgen,
  // getByRole fände ihn dann nicht
  await page
    .locator(`input[name="darstellung"][value="${modus.toLowerCase()}"]`)
    .evaluate((e: HTMLInputElement) => e.click());
  await expect.poll(() => page.evaluate(() => localStorage.getItem("belegt.darstellung"))).toBe(modus.toLowerCase());
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
}

/** Hell und dunkel mit Rahmen; oben ein Ausschnitt der Seite (selector), am Handy sonst der Inhalt unter der Navigation */
async function bild(page: Page, name: string, oben?: string) {
  const mobil = page.viewportSize()?.width === MOBIL.width;
  const ziel = oben ?? (mobil ? "#inhalt" : undefined);
  for (const modus of ["Hell", "Dunkel"] as const) {
    await darstellung(page, modus);
    if (ziel)
      await page
        .locator(ziel)
        .first()
        .evaluate((e) => e.scrollIntoView({ block: "start" }));
    // Sonst von oben: ein Klick vorher (etwa „Jetzt prüfen“ auf der Startseite) hat die Seite gescrollt
    else await page.evaluate(() => window.scrollTo(0, 0));
    const png = await page.screenshot({ animations: "disabled", caret: "hide" });
    const pfad = `${ASSETS}/screenshot-${name}${modus === "Dunkel" ? "-dunkel" : ""}.png`;
    await writeFile(pfad, await mitRahmen(rahmenBrowser, png, modus === "Dunkel" ? "dunkel" : "hell", mobil ? 36 : 12));
  }
  await darstellung(page, "Hell");
}

test("Bilder für README und Doku", async ({ page, browser }) => {
  test.setTimeout(240_000);
  rahmenBrowser = browser;
  const { holz, steuer, material, rechnung, betrag } = await vorbereiten(page);

  // Die ZUGFeRD-Rechnung mit Vorschau, Kopfdaten und Prüfung
  await page.goto(`/dokumente/${holz.id}`);
  await expect(page.getByRole("region", { name: "E-Rechnung" })).toBeVisible();
  await page.waitForTimeout(1500);
  await bild(page, "dokument");
  // danach eingeordnet, damit Archiv und Start sie zeigen
  await page.request.post(`/api/dokumente/${holz.id}/einordnung`, {
    data: {
      art: "beleg",
      entstanden: "2026-11-03",
      titel: "Rechnung HK-2026-1187",
      korrespondent: "Holzhandel Kranich GmbH",
    },
  });
  await page.request.post(`/api/dokumente/${holz.id}/ordnung`, {
    data: { tagsHinzu: [steuer, material], dokumenttyp: rechnung, felder: [{ feldId: betrag, wert: "1.475,60" }] },
  });

  await page.goto("/archiv");
  await expect(page.getByRole("link", { name: "Strom Oktober" })).toBeVisible();
  await bild(page, "archiv");

  // Volltext: „Rechnung“ findet Titel, Mail, XRechnung und den Text in den PDFs
  await page.goto("/archiv?suche=Rechnung");
  await expect(page.getByRole("link", { name: "Rechnung HK-2026-1187", exact: true })).toBeVisible();
  await bild(page, "suche");

  // Eingang mit Mehrfachauswahl: zwei Scans gewählt, darüber die Sammelbearbeitung; daneben „Foto aufnehmen“
  await page.goto("/eingang");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Foto aufnehmen" })).toBeVisible();
  for (const name of ["Scan-Tankquittung.pdf", "Scan-Bewirtung.pdf"])
    await page.getByRole("checkbox", { name: `${name} auswählen` }).check();
  await bild(page, "eingang");

  // Ordnung: Kacheln mit Vorschaubild, Korrespondent, Typ und Tags, darüber die Filter
  await page.goto("/archiv?darstellung=kacheln");
  await expect(page.getByRole("link", { name: "Strom Oktober" })).toBeVisible();
  await page.waitForTimeout(1000);
  await bild(page, "ordnung");

  await page.goto("/fristen");
  await expect(page.getByRole("heading", { level: 1, name: "Fristen" })).toBeVisible();
  await bild(page, "fristen");

  await page.goto("/pruefung");
  await expect(page.getByRole("region", { name: "Prüfbericht" })).toBeVisible();
  await bild(page, "pruefung");

  await page.goto("/verfahrensdoku");
  await expect(page.getByRole("status")).toBeVisible();
  // Die erzeugte Dokumentation steht unter dem Formular „Angaben zum Betrieb“; das Bild zeigt sie ohne das Formular
  await page
    .getByRole("region", { name: "Angaben zum Betrieb" })
    .evaluate((e: HTMLElement) => e.style.setProperty("display", "none"));
  await bild(page, "verfahrensdoku");

  await page.goto("/workflows");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await bild(page, "workflows");

  // Startseite mit einer Kachel aus einer gespeicherten Ansicht
  const ansicht = await page.request.post("/api/ansichten", {
    data: { name: "Steuer 2026", parameter: { suche: "Rechnung" } },
  });
  await page.request.put("/api/start/kacheln", { data: { ansichten: [(await ansicht.json()).id] } });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Steuer 2026" })).toContainText("Dokumente");
  await page.getByRole("region", { name: "Unveränderbarkeit" }).getByRole("button", { name: "Jetzt prüfen" }).click();
  await expect(page.getByRole("region", { name: "Unveränderbarkeit" })).toContainText("in Ordnung");
  // Die Startseite ganz, mit den Kacheln unten: höher als die übrigen Bilder (docs/index.md nennt die Größe)
  await page.setViewportSize({ width: 1440, height: 1120 });
  await bild(page, "start");
  await page.setViewportSize({ width: 1440, height: 900 });

  // Am Handy: der Eingang mit „Foto aufnehmen“, als Kacheln
  await page.setViewportSize(MOBIL);
  await page.goto("/eingang");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await page.getByRole("button", { name: "Kacheln" }).click();
  await page.waitForTimeout(500);
  await bild(page, "mobil");
});
