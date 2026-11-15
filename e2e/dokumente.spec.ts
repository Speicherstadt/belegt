import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PDF = Buffer.from("%PDF-1.7\n% erfundene Rechnung über 119,00 €\n");

test("ein hochgeladenes Original erscheint im Archiv, mit Verlauf, Nachweis und unveränderter Datei", async ({
  page,
}, info) => {
  const name = `Rechnung-${info.project.name}.pdf`;
  await page.goto("/archiv");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();

  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill(`-${info.project.name}`);
  await expect(link).toBeVisible();
  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill("gibt-es-nicht");
  await expect(page.getByText("Noch keine Dokumente")).toBeVisible();
  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill("");

  await link.click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page).toHaveTitle(`${name} · Belegt`);
  const verlauf = page
    .getByRole("region", { name: "Verlauf" })
    .or(page.locator("section", { has: page.getByRole("heading", { name: "Verlauf" }) }));
  await expect(verlauf).toContainText("Eingegangen");
  await expect(verlauf).toContainText("Versiegelt");
  await expect(verlauf).toContainText("nutzer:anna@example.org");
  await expect(page.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible();

  const href = await page.getByRole("link", { name: "Original herunterladen" }).getAttribute("href");
  const datei = await page.request.get(href!);
  expect(datei.status()).toBe(200);
  expect(Buffer.from(await datei.body())).toEqual(PDF);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Die Vorschau im Frame (PDF-Ansicht des Browsers) gehört nicht zu Belegt
    const axe = await new AxeBuilder({ page })
      .exclude("iframe")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
});

test("die Prüfung meldet eine intakte Kette", async ({ page }) => {
  await page.goto("/pruefung");
  await expect(page.getByRole("status")).toHaveText("Kette intakt, alle Siegel stimmen.");
  await page.getByRole("button", { name: "Auch alle Dateien prüfen" }).click();
  await expect(page.getByRole("status")).toContainText("Dateien gegen ihren Hash geprüft.");
});

test("Archiv blättert in Seiten zu 50 und nennt „x von y“; „alle auf dieser Seite“ wählt nur die Seite", async ({
  page,
}, info) => {
  const praefix = `Blatt-${info.project.name}`;
  // Dateien, die niemand liest, gleich frei abgelegt: sonst stünden sie vor den Tests danach in der Warteschlange von
  // Inhalten und Sprachmodell (e2e/server.ts)
  const ids: string[] = [];
  for (let i = 1; i <= 52; i++) {
    const name = `${praefix}-${String(i).padStart(2, "0")}.pdf`;
    const buffer = Buffer.from(`daten ${name}`);
    const res = await page.request.post("/api/dokumente", {
      multipart: { datei: { name, mimeType: "application/octet-stream", buffer } },
    });
    ids.push(((await res.json()) as { id: string }).id);
  }
  const sammeln = await page.request.post("/api/dokumente/sammeln", {
    data: { ids, einordnung: { art: "frei", entstanden: "eingang", nurOffene: true } },
  });
  expect(sammeln.ok()).toBe(true);
  await page.goto("/archiv");
  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill(praefix);
  const seiten = page.getByRole("navigation", { name: "Seiten" });
  await expect(seiten).toContainText("1–50 von 52");
  await expect(seiten).toContainText("Seite 1 von 2");
  await expect(page.getByRole("link", { name: `${praefix}-52.pdf` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${praefix}-01.pdf` })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Alle auf dieser Seite auswählen" }).check();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(51);

  await seiten.getByRole("button", { name: "Weiter" }).click();
  await expect(seiten).toContainText("51–52 von 52");
  await expect(page.getByRole("link", { name: `${praefix}-01.pdf` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${praefix}-52.pdf` })).toHaveCount(0);
  // Die Auswahl der ersten Seite kommt nicht mit
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(seiten.getByRole("button", { name: "Weiter" })).toBeDisabled();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations,
      colorScheme,
    ).toEqual([]);
  }
  await seiten.getByRole("button", { name: "Zurück" }).click();
  await expect(seiten).toContainText("1–50 von 52");
});
