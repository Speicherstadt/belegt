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
    await expect(kanzlei.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
    // Die Steuerberatung sieht die Startseite mit Löschanträgen und Quellen, lädt aber nichts hoch
    await expect(kanzlei.getByText("Offene Löschanträge")).toBeVisible();
    await kanzlei.goto("/eingang");
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
    await expect(pruefer.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
    // Auf der Startseite nur Zahlen seines Zeitraums und die Kette, nichts zu Löschanträgen, Sperren und Quellen
    const ueberblick = pruefer.getByRole("region", { name: "Überblick" });
    await expect(ueberblick).toContainText("Dokumente im Archiv");
    await expect(pruefer.getByText("Offene Löschanträge")).toHaveCount(0);
    await expect(pruefer.getByRole("heading", { name: "Quellen" })).toHaveCount(0);
    await expect(pruefer.getByRole("heading", { name: "Unveränderbarkeit" })).toBeVisible();

    const nav = pruefer.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link")).toHaveText(["Start", "Eingang", "Archiv", "Prüfung"]);

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

test("ein Mitarbeiter sieht nur die Dokumente seines Sichtbereichs und bearbeitet sie", async ({
  page,
  browser,
}, info) => {
  const tagName = `Team-${info.project.name}`;
  const tag = await (await page.request.post("/api/tags", { data: { name: tagName } })).json();
  const hoch = async (name: string) =>
    (
      await (
        await page.request.post("/api/dokumente", {
          multipart: { datei: { name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n% ${name}\n`) } },
        })
      ).json()
    ).id as string;
  const sichtbar = `team-plan-${info.project.name}.pdf`;
  const geheim = `geheim-${info.project.name}.pdf`;
  const sichtbarId = await hoch(sichtbar);
  const geheimId = await hoch(geheim);
  await page.request.post(`/api/dokumente/${sichtbarId}/ordnung`, { data: { tagsHinzu: [tag.id] } });

  await page.goto("/zugaenge");
  await page.getByLabel("Rolle").selectOption("mitarbeiter");
  await page.getByLabel("Recht").selectOption("bearbeiten");
  await page.getByRole("group", { name: "Tags", exact: true }).getByLabel(tagName).check();
  await expect(page.getByText(`Sieht Dokumente mit Tag „${tagName}“`)).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Einladen" }).click();
  const link = await page.getByRole("status").locator("code").textContent();

  const fremd = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "de-DE" });
  const kollege = await fremd.newPage();
  try {
    await kollege.goto(link!);
    await expect(kollege.getByText("Du wurdest als Mitarbeiter eingeladen")).toBeVisible();
    await kollege.getByLabel("E-Mail-Adresse").fill(`mitarbeiter-${info.project.name}@example.org`);
    await kollege.getByLabel("Passwort").fill("ein-langes-mitarbeiter-passwort");
    await kollege.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(kollege.getByRole("heading", { level: 1, name: "Start" })).toBeVisible();
    await expect(kollege.getByText("Offene Löschanträge")).toHaveCount(0);
    // Nichts, was er nicht abrufen darf, und darum keine Fehlermeldung
    await expect(kollege.getByRole("heading", { name: "Unveränderbarkeit" })).toHaveCount(0);
    await expect(kollege.getByRole("alert")).toHaveCount(0);

    const nav = kollege.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link")).toHaveText(["Start", "Eingang", "Archiv"]);
    await nav.getByRole("link", { name: "Archiv" }).click();
    await expect(kollege.getByRole("link", { name: sichtbar })).toBeVisible();
    await expect(kollege.getByRole("link", { name: geheim })).toHaveCount(0);
    // Was andere Tests hochladen, hat nicht seinen Tag; übrig bleiben Kopfzeile und sein Dokument
    await expect(kollege.getByRole("row")).toHaveCount(2);
    for (const colorScheme of ["light", "dark"] as const) {
      await kollege.emulateMedia({ colorScheme });
      const axe = await new AxeBuilder({ page: kollege })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(axe.violations, colorScheme).toEqual([]);
    }

    // Ein Dokument außerhalb, per Adresse aufgerufen: gibt es nicht
    await kollege.goto(`/dokumente/${geheimId}`);
    await expect(kollege.getByText("Dieses Dokument gibt es nicht.")).toBeVisible();
    // Sein Dokument darf er einordnen; Hochladen bietet ihm der Eingang an, Mails einlesen nicht
    await kollege.goto("/eingang");
    await expect(kollege.getByRole("button", { name: "Hochladen" })).toBeVisible();
    await expect(kollege.getByRole("button", { name: "Mails importieren" })).toHaveCount(0);
  } finally {
    await fremd.close();
  }

  // Der Inhaber sieht ihn mit Recht und Sichtbereich und entzieht den Zugang
  await page.reload();
  const konto = page
    .getByRole("region", { name: "Konten" })
    .getByRole("listitem")
    .filter({ hasText: `mitarbeiter-${info.project.name}@example.org` });
  await expect(konto).toContainText("Lesen und bearbeiten");
  await konto.getByRole("button", { name: `mitarbeiter-${info.project.name}@example.org: Zugang entziehen` }).click();
  await konto.getByRole("button", { name: /wirklich entziehen/ }).click();
  await expect(konto).toContainText("entzogen am");
});
