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
