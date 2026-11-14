import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function rechnungsmail(projekt: string): Buffer {
  const pdf = Buffer.from(`%PDF-1.7\n% Rechnung ${projekt}\n`).toString("base64");
  return Buffer.from(
    [
      "From: Telekom <rechnung@telekom.de>",
      "To: anna@example.org",
      `Subject: Ihre Rechnung ${projekt}`,
      "Date: Tue, 03 Nov 2026 08:12:04 +0100",
      `Message-ID: <rechnung-${projekt}@telekom.de>`,
      'Content-Type: multipart/mixed; boundary="g"',
      "",
      "--g",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Guten Tag, anbei die Rechnung.",
      "--g",
      'Content-Type: application/pdf; name="Rechnung.pdf"',
      'Content-Disposition: attachment; filename="Rechnung.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      pdf,
      "--g--",
      "",
    ].join("\r\n"),
  );
}

test("Regel anlegen, Mail mit Anhang importieren, Vorschlag übernehmen", async ({ page }, info) => {
  await page.goto("/quellen");
  const regeln = page.locator("section", { has: page.getByRole("heading", { name: "Regeln" }) });
  await regeln.getByLabel("Name").fill(`Telekom ${info.project.name}`);
  await regeln.getByLabel("Domain").fill("telekom.de");
  await regeln.getByLabel("Anhangstyp").fill("application/pdf");
  await regeln.getByLabel("Dann").selectOption("beleg");
  await regeln.getByRole("button", { name: "Regel anlegen" }).click();
  await expect(regeln.getByRole("listitem").filter({ hasText: `Telekom ${info.project.name}` })).toContainText("aktiv");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations,
  ).toEqual([]);

  await page.goto("/");
  await page
    .getByTestId("mail-import")
    .setInputFiles({ name: "rechnung.eml", mimeType: "message/rfc822", buffer: rechnungsmail(info.project.name) });
  await expect(page.getByRole("status")).toHaveText("1 neu, 0 schon vorhanden");
  await page.getByRole("link", { name: `Ihre Rechnung ${info.project.name}.eml` }).click();

  const mail = page.locator("section", { has: page.getByRole("heading", { name: "E-Mail" }) });
  await expect(mail).toContainText("rechnung@telekom.de");
  await expect(mail).toContainText("Guten Tag, anbei die Rechnung.");
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await expect(einordnung).toContainText(`Vorschlag: Buchungsbelege (Regel „Telekom`);
  await einordnung.getByLabel("Art").selectOption("frei");
  await einordnung.getByRole("button", { name: "Übernehmen" }).click();
  await expect(einordnung.getByLabel("Art")).toHaveValue("beleg");
  expect(
    (await new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze())
      .violations,
  ).toEqual([]);

  await mail.getByRole("link", { name: "Rechnung.pdf" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rechnung.pdf" })).toBeVisible();
  await expect(page.getByText("Anhang der Mail")).toBeVisible();

  await page.goto("/");
  await page
    .getByTestId("mail-import")
    .setInputFiles({ name: "rechnung.eml", mimeType: "message/rfc822", buffer: rechnungsmail(info.project.name) });
  await expect(page.getByRole("status")).toHaveText("0 neu, 1 schon vorhanden");
});

test("ein Postfach hinzufügen; ein Abruf gegen einen nicht erreichbaren Server zeigt den Fehler", async ({
  page,
}, info) => {
  await page.goto("/quellen");
  const postfaecher = page.locator("section", { has: page.getByRole("heading", { name: "Postfächer" }) });
  await postfaecher.getByLabel("Name").fill(`rechnung-${info.project.name}`);
  await postfaecher.getByLabel("Server").fill("127.0.0.1");
  await postfaecher.getByLabel("Port").fill("1");
  await postfaecher.getByLabel("Benutzer").fill("rechnung@example.org");
  await postfaecher.getByLabel("Passwort").fill("geheim-im-test");
  await postfaecher.getByLabel("TLS").uncheck();
  await postfaecher.getByRole("button", { name: "Postfach hinzufügen" }).click();
  const eintrag = postfaecher.getByRole("listitem").filter({ hasText: `rechnung-${info.project.name}` });
  await expect(eintrag).toContainText("Noch nicht abgerufen");
  await eintrag.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(eintrag).toContainText("Fehler:");
  await expect(page.getByText("geheim-im-test")).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations,
  ).toEqual([]);
});

test("ein Gmail-Postfach über OAuth verbinden", async ({ page }) => {
  // Playwright fängt Weiterleitungen nicht ab: Den Start holt der Test selbst, nimmt Cookie und state aus der Antwort
  // von Belegt und schickt den Browser statt zur Anmeldeseite von Google gleich mit einem Code zurück
  await page.route("**/api/oauth/google/start**", async (route) => {
    const antwort = await route.fetch({ maxRedirects: 0 });
    const ziel = new URL(antwort.headers().location!);
    expect(ziel.origin).toBe("https://accounts.google.com");
    expect(ziel.searchParams.get("code_challenge_method")).toBe("S256");
    await route.fulfill({
      status: 302,
      headers: {
        location: `/api/oauth/rueckkehr?code=e2e&state=${ziel.searchParams.get("state")}`,
        "set-cookie": antwort.headers()["set-cookie"]!,
      },
    });
  });
  await page.goto("/quellen");
  await page.getByRole("link", { name: "Mit Google verbinden" }).click();
  await expect(page).toHaveURL(/\/quellen\?oauth=verbunden$/);
  await expect(page.getByRole("status").filter({ hasText: "Postfach verbunden." })).toBeVisible();
  await expect(page.getByText(/IMAP \(Google\) · anna@gmail\.example@\s*imap\.gmail\.com/).first()).toBeVisible();
});
