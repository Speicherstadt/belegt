import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { INHABER_EMAIL, INHABER_PASSWORT } from "./zugang.ts";

/*
 * Unterwegs: installierbare App (Manifest, Service Worker), Teilen an Belegt (share_target) und Foto aufnehmen. Der
 * Worker läuft hier wirklich: Vite liefert ihn wie der Server aus dist aus (src/pwa/plugin.ts).
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Wartet, bis der Service Worker die Seite steuert */
async function workerBereit(page: Page) {
  const skript = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  expect(skript).toMatch(/\/sw\.js$/);
}

/** Alle Adressen in allen Caches dieser Seite */
const gecacht = (page: Page) =>
  page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const r of await (await caches.open(name)).keys()) urls.push(`${name} ${new URL(r.url).pathname}`);
    return urls;
  });

/** Teilt eine Datei an Belegt wie das Betriebssystem: POST multipart auf /teilen als Navigation */
async function teilen(page: Page, datei: { name: string; mimeType: string; buffer: Buffer }) {
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/teilen";
    form.enctype = "multipart/form-data";
    form.id = "teilen";
    const eingabe = document.createElement("input");
    eingabe.type = "file";
    eingabe.name = "dateien";
    form.append(eingabe);
    document.body.append(form);
  });
  await page.locator("#teilen input").setInputFiles(datei);
  await page.evaluate(() => (document.getElementById("teilen") as HTMLFormElement).submit());
  await page.waitForURL(/\/teilen$/);
}

const imEingang = async (page: Page, name: string) =>
  ((await (await page.request.get("/api/dokumente?gruppe=offen&limit=200")).json()) as { dateiname: string }[]).some(
    (d) => d.dateiname === name,
  );

test("Manifest mit Symbolen, Farben für hell und dunkel und Ziel zum Teilen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Belegt", start_url: "/", display: "standalone" });
  expect(manifest.share_target).toMatchObject({ action: "/teilen", method: "POST", enctype: "multipart/form-data" });
  const symbole = [
    ...manifest.icons.map((i: { src: string }) => i.src),
    await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"),
  ];
  for (const src of symbole) {
    const bild = await page.request.get(src);
    expect(bild.status(), src).toBe(200);
    expect(bild.headers()["content-type"]).toBe("image/png");
  }
});

test("der Service Worker cacht nur die Hinweisseite und zeigt sie ohne Verbindung", async ({ page, context }, info) => {
  await page.goto("/");
  await workerBereit(page);
  // Seiten und Schnittstelle benutzen, auch ein Original
  await page.getByTestId("upload").setInputFiles({
    name: `sw-${info.project.name}.png`,
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByRole("link", { name: `sw-${info.project.name}.png` }).click();
  await expect(page.getByRole("img", { name: `sw-${info.project.name}.png` })).toBeVisible();
  await page.goto("/archiv");
  await expect(page.getByRole("heading", { level: 1, name: "Archiv" })).toBeVisible();

  const urls = await gecacht(page);
  expect(urls.some((u) => u.includes("/api/"))).toBe(false);
  expect(urls).toEqual([expect.stringMatching(/^belegt-offline-[0-9a-f]{12} \/offline\.html$/)]);

  await context.setOffline(true);
  await page.goto("/fristen");
  await expect(page.getByRole("heading", { level: 1, name: "Keine Verbindung" })).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null });
  await context.setOffline(false);
  await page.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Fristen" })).toBeVisible();
});

test("geteilte Dateien kommen erst nach dem Klick in den Eingang", async ({ page }, info) => {
  const name = `geteilt-${info.project.name}.pdf`;
  await page.goto("/");
  await workerBereit(page);
  await teilen(page, { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%geteilt\n") });

  const liste = page.getByRole("list", { name: "Geteilte Dateien" });
  await expect(liste).toContainText(name);
  await expect(liste).toContainText("application/pdf");
  // Bis zum Klick liegt nichts auf dem Server
  expect(await imEingang(page, name)).toBe(false);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: null });

  await page.getByRole("button", { name: "In den Eingang" }).click();
  await expect(page.getByRole("status")).toContainText("Im Eingang: 1 Dateien.");
  expect(await imEingang(page, name)).toBe(true);
  // Die Zwischenablage ist leer
  expect((await gecacht(page)).some((u) => u.startsWith("belegt-teilen"))).toBe(false);
  await page.getByRole("link", { name: "Zum Eingang" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("verworfen oder von einer fremden Seite geteilt, kommt nichts in den Eingang", async ({ page, context }, info) => {
  const name = `verworfen-${info.project.name}.pdf`;
  await page.goto("/");
  await workerBereit(page);
  await teilen(page, { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%verworfen\n") });
  await expect(page.getByRole("list", { name: "Geteilte Dateien" })).toContainText(name);
  await page.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("heading", { name: "Nichts zum Aufnehmen" })).toBeVisible();
  expect(await imEingang(page, name)).toBe(false);

  // Eine fremde Seite schickt ein Formular an /teilen: Der Worker legt nichts ab
  const ziel = new URL("/teilen", page.url()).href;
  await context.route("http://fremd.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Fremd</title><form method="post" action="${ziel}" enctype="multipart/form-data"><input type="file" name="dateien"></form>`,
    }),
  );
  await page.goto("http://fremd.example/");
  await page
    .locator("input")
    .setInputFiles({ name: "fremd.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
  await page.evaluate(() => document.querySelector("form")!.submit());
  await page.waitForURL(/\/teilen$/);
  await expect(page.getByRole("heading", { name: "Nichts zum Aufnehmen" })).toBeVisible();
  expect(await imEingang(page, "fremd.pdf")).toBe(false);
});

test.describe("ohne Sitzung", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("geteilt ohne Anmeldung: erst anmelden, dann zurück zu den Dateien; Abmelden räumt sie weg", async ({
    page,
  }, info) => {
    const name = `vor-anmeldung-${info.project.name}.png`;
    await page.goto("/anmelden");
    await workerBereit(page);
    await teilen(page, { name, mimeType: "image/png", buffer: PNG });
    await expect(page).toHaveURL(/\/anmelden$/);
    await page.getByLabel("E-Mail-Adresse").fill(INHABER_EMAIL);
    await page.getByLabel("Passwort").fill(INHABER_PASSWORT);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page).toHaveURL(/\/teilen$/);
    await expect(page.getByRole("list", { name: "Geteilte Dateien" })).toContainText(name);

    // Nicht aufgenommen und abgemeldet: Danach liegt nichts mehr im Browser außer der Hinweisseite
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/anmelden$/);
    expect((await gecacht(page)).every((u) => u.endsWith("/offline.html"))).toBe(true);
    expect(await page.evaluate(() => caches.has("belegt-teilen"))).toBe(false);
  });
});

test("Foto aufnehmen lädt jedes Bild sofort in den Eingang, eines nach dem anderen", async ({ page }, info) => {
  await page.goto("/");
  const foto = page.getByTestId("foto");
  await expect(foto).toHaveAttribute("capture", "environment");
  await expect(foto).toHaveAttribute("accept", "image/*");
  await expect(page.getByRole("button", { name: "Foto aufnehmen" })).toBeVisible();
  for (const n of [1, 2]) {
    const name = `foto-${n}-${info.project.name}.png`;
    await foto.setInputFiles({ name, mimeType: "image/png", buffer: PNG });
    await expect(page.getByRole("status")).toContainText(`Fotos im Eingang: ${n}`);
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
});
