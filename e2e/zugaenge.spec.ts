import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("der Inhaber lädt die Steuerberatung ein; sie liest, lädt aber nichts hoch", async ({ page, browser }, info) => {
  await page.goto("/zugaenge");
  await expect(page.getByRole("heading", { level: 1, name: "Zugänge" })).toBeVisible();
  await page.getByLabel("Rolle").selectOption("steuerberatung");
  await page.getByRole("button", { name: "Einladen" }).click();
  const link = await page.getByRole("status").locator("code").textContent();
  expect(link).toMatch(/\/einladung\/[A-Za-z0-9_-]{40,}$/);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);

  const fremd = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });
  const kanzlei = await fremd.newPage();
  try {
    await kanzlei.goto(link!);
    await expect(kanzlei.getByText("Du wurdest als Steuerberatung eingeladen")).toBeVisible();
    await kanzlei.getByLabel("E-Mail-Adresse").fill(`kanzlei-${info.project.name}@example.org`);
    await kanzlei.getByLabel("Passwort").fill("ein-langes-kanzlei-passwort");
    await kanzlei.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(kanzlei.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
    await expect(kanzlei.getByRole("button", { name: "Hochladen" })).toHaveCount(0);
    await expect(kanzlei.getByRole("link", { name: "Zugänge" })).toHaveCount(0);

    await kanzlei.goto(link!);
    await expect(kanzlei.getByText("Diese Einladung ist ungültig")).toBeVisible();
  } finally {
    await fremd.close();
  }

  await page.reload();
  await expect(page.getByText(`kanzlei-${info.project.name}@example.org`).first()).toBeVisible();
});

test("ein Prüfer sieht nur Archiv und Prüfung und nur Dokumente seines Zeitraums", async ({ page, browser }, info) => {
  const name = `pruefung-2001-${info.project.name}.pdf`;
  const hochgeladen = await page.request.post("/api/dokumente", {
    multipart: { datei: { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% erfunden\n") } },
  });
  const { id } = await hochgeladen.json();
  await page.request.post(`/api/dokumente/${id}/einordnung`, { data: { art: "beleg", entstanden: "2001-06-01" } });

  await page.goto("/zugaenge");
  await page.getByLabel("Rolle").selectOption("pruefer");
  await page.getByLabel("Von").fill("2001-01-01");
  await page.getByLabel("Bis").fill("2001-12-31");
  await page.getByRole("button", { name: "Einladen" }).click();
  const link = await page.getByRole("status").locator("code").textContent();

  const fremd = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });
  const pruefer = await fremd.newPage();
  try {
    await pruefer.goto(link!);
    await expect(pruefer.getByText("Freigegeben ist der Zeitraum 01.01.2001 bis 31.12.2001")).toBeVisible();
    await pruefer.getByLabel("E-Mail-Adresse").fill(`pruefer-${info.project.name}@example.org`);
    await pruefer.getByLabel("Passwort").fill("ein-langes-pruefer-passwort");
    await pruefer.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(pruefer.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();

    const nav = pruefer.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link")).toHaveText(["Eingang", "Archiv", "Prüfung"]);

    await nav.getByRole("link", { name: "Archiv" }).click();
    await expect(pruefer.getByRole("link", { name })).toBeVisible();
    // Was andere Tests heute hochladen, liegt außerhalb von 2001; übrig bleibt nur die Kopfzeile
    await expect(pruefer.getByRole("row").filter({ hasNotText: "pruefung-2001-" })).toHaveCount(1);

    await nav.getByRole("link", { name: "Prüfung" }).click();
    await expect(pruefer.getByText("Freigegeben für deinen Zugang: 01.01.2001 bis 31.12.2001.")).toBeVisible();
    await expect(pruefer.getByLabel("Von")).toHaveValue("2001-01-01");
  } finally {
    await fremd.close();
  }
});
