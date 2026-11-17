import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Je Projekt eine eigene Datei: Dieselbe nimmt Belegt nur einmal auf, und Desktop und Handy teilen die Datenbank
const pdfFuer = (projekt: string) => Buffer.from(`%PDF-1.7\n% erfundene Rechnung über 119,00 € (${projekt})\n`);

test("ein hochgeladenes Original erscheint im Archiv, mit Verlauf, Nachweis und unveränderter Datei", async ({
  page,
}, info) => {
  const name = `Rechnung-${info.project.name}.pdf`;
  const PDF = pdfFuer(info.project.name);
  await page.goto("/archiv");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer: PDF });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();

  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill(`-${info.project.name}`);
  await expect(link).toBeVisible();
  await page.getByLabel("Volltext in Dokumenten, Mails und Anhängen").fill("gibt-es-nicht");
  await expect(page.getByText("Keine Treffer für „gibt-es-nicht“")).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText(/\d+ (Datei|Dateien) gegen ihren Hash geprüft\./);
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

test("dieselbe Datei noch einmal hochgeladen: kein zweites Dokument, Link auf das vorhandene", async ({
  page,
}, info) => {
  const name = `doppelt-${info.project.name}.pdf`;
  const buffer = Buffer.from(`%PDF-1.7\n% ${name}\n`);
  await page.goto("/archiv");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer });
  const link = page.getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  const { asn } = (await (await page.request.get(`/api/dokumente/${id}`)).json()) as { asn: number };

  await page.getByTestId("upload").setInputFiles({ name: "nochmal.pdf", mimeType: "application/pdf", buffer });
  const hinweis = page.getByRole("status", { name: "Schon im Archiv" });
  await expect(hinweis).toContainText("„nochmal.pdf“ liegt schon im Archiv, nichts Neues angelegt:");
  await expect(page.getByRole("link", { name: "nochmal.pdf" })).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page })
      .exclude("iframe")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
  await hinweis.getByRole("link", { name: `ASN ${asn} öffnen` }).click();
  await expect(page).toHaveURL(new RegExp(`/dokumente/${id}$`));
});

test("Suche ohne Treffer sagt „Keine Treffer“, „Filter zurücksetzen“ leert Suche und Filter", async ({ page }) => {
  await page.goto("/archiv");
  const suche = page.getByLabel("Volltext in Dokumenten, Mails und Anhängen");
  await suche.fill("gibt-es-nicht");
  const pflicht = page.getByRole("button", { name: "Pflicht" });
  await pflicht.click();
  await expect(pflicht).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Keine Treffer für „gibt-es-nicht“" })).toBeVisible();
  await expect(page.getByText("Noch keine Dokumente")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
  await expect(suche).toHaveValue("");
  await expect(suche).toBeFocused();
  await expect(pflicht).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Alle", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /Keine Treffer/ })).toHaveCount(0);
});

test("ein Filter ohne Suche ohne Treffer sagt „Keine Treffer“ ohne Suchbegriff", async ({ page }) => {
  await page.route("**/api/dokumente?*", (route) => route.fulfill({ json: [], headers: { "x-gesamt": "0" } }));
  await page.goto("/archiv");
  const pflicht = page.getByRole("button", { name: "Pflicht" });
  await pflicht.click();
  await expect(pflicht).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Keine Treffer", exact: true })).toBeVisible();
  await expect(page.getByText("Noch keine Dokumente")).toHaveCount(0);
  await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
  await expect(pflicht).toHaveAttribute("aria-pressed", "false");
});

test("ohne Recht zum Bearbeiten bietet ein leeres Archiv kein Hochladen an", async ({ page }) => {
  await page.route("**/api/dokumente?*", (route) => route.fulfill({ json: [], headers: { "x-gesamt": "0" } }));
  await page.route("**/api/ich", async (route) => {
    const antwort = await route.fetch();
    await route.fulfill({ response: antwort, json: { ...(await antwort.json()), role: "pruefer" } });
  });
  await page.goto("/archiv");
  await expect(page.getByRole("heading", { name: "Noch keine Dokumente" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dokument hochladen" })).toHaveCount(0);
});

test("ein leerer Eingang bietet das Hochladen an", async ({ page }) => {
  await page.route("**/api/dokumente?*", (route) => route.fulfill({ json: [], headers: { "x-gesamt": "0" } }));
  await page.goto("/eingang");
  await expect(page.getByRole("heading", { name: "Eingang ist leer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dokument hochladen" })).toBeVisible();
});

test("ein leeres Archiv sagt „Noch keine Dokumente“ und bietet das Hochladen an", async ({ page }) => {
  await page.route("**/api/dokumente?*", (route) => route.fulfill({ json: [], headers: { "x-gesamt": "0" } }));
  await page.goto("/archiv");
  await expect(page.getByRole("heading", { name: "Noch keine Dokumente" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Keine Treffer/ })).toHaveCount(0);
  const knopf = page.getByRole("button", { name: "Dokument hochladen" });
  await expect(knopf).toBeVisible();
  // Genau eine Hauptaktion: „Hochladen“ in der Leiste ist im Leerzustand zweitrangig (ohne Primärfarbe)
  await expect(page.getByRole("button", { name: "Hochladen", exact: true })).not.toHaveClass(/bg-primary/);
  const dialog = page.waitForEvent("filechooser");
  await knopf.click();
  await dialog;
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
});

test("nach „Filter zurücksetzen“ erscheint „Noch keine Dokumente“ nicht, solange die Antwort aussteht", async ({
  page,
}) => {
  let verzoegern = false;
  let freigeben = () => {};
  const frei = new Promise<void>((r) => {
    freigeben = r;
  });
  await page.route("**/api/dokumente?*", async (route) => {
    if (verzoegern) await frei;
    await route.fulfill({ json: [], headers: { "x-gesamt": "0" } });
  });
  // Direkt mit Suche öffnen: Die Abfrage ohne Suche ist noch nicht im Zwischenspeicher, nur Platzhalterdaten wären da
  await page.goto("/archiv?suche=gibt-es-nicht");
  await expect(page.getByRole("heading", { name: "Keine Treffer für „gibt-es-nicht“" })).toBeVisible();
  verzoegern = true;
  await page.getByRole("button", { name: "Filter zurücksetzen" }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText("Noch keine Dokumente")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dokument hochladen" })).toHaveCount(0);
  freigeben();
  await expect(page.getByRole("heading", { name: "Noch keine Dokumente" })).toBeVisible();
});

test("nach dem Hochladen aus dem Leerzustand steht der Fokus auf „Hochladen“ in der Leiste", async ({ page }, info) => {
  await page.route("**/api/dokumente?*", (route) => route.fulfill({ json: [], headers: { "x-gesamt": "0" } }));
  await page.goto("/archiv");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Dokument hochladen" }).click();
  const antwort = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/dokumente"));
  await (await chooser).setFiles({
    name: `Fokus-${info.project.name}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.7\n% Fokus ${info.project.name} ${Date.now()}\n`),
  });
  await antwort;
  const knopf = page.getByRole("button", { name: "Hochladen", exact: true });
  await expect(knopf).not.toHaveAttribute("aria-busy", "true");
  await expect(knopf).toBeFocused();
});
