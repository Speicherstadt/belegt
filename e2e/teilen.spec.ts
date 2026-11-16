import AxeBuilder from "@axe-core/playwright";
import { expect, request, test } from "@playwright/test";

test("Teilen per Link: Link anlegen, ohne Anmeldung herunterladen, Abruf sehen, widerrufen", async ({ page }, info) => {
  const name = `kaufvertrag-${info.project.name}.pdf`;
  const inhalt = Buffer.from(`%PDF-1.4\n%Kaufvertrag ${info.project.name}\n`);
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "application/pdf", buffer: inhalt });
  await page.getByRole("link", { name }).click();

  const bereich = page.getByRole("region", { name: "Teilen per Link" });
  await bereich.getByRole("radio", { name: "1 Tag" }).check();
  await bereich.getByRole("button", { name: "Link anlegen" }).click();
  const feld = bereich.getByRole("textbox", { name: "Neuer Link" });
  await expect(feld).toHaveValue(/\/api\/geteilt\/[A-Za-z0-9_-]{43}$/);
  const url = await feld.inputValue();
  const links = bereich.getByRole("list", { name: "Gültige Links" });
  await expect(links).toContainText("Noch nicht abgerufen");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude("iframe").analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }

  // Wer den Link hat, braucht keine Anmeldung
  const fremd = await request.newContext();
  const datei = await fremd.get(url);
  expect(datei.status()).toBe(200);
  expect(Buffer.from(await datei.body())).toEqual(inhalt);
  expect(datei.headers()["content-disposition"]).toMatch(/^attachment;/);
  expect(datei.headers()["cache-control"]).toBe("no-store");

  await page.reload();
  await expect(links).toContainText("1-mal abgerufen");
  // Nach dem Neuladen steht der Link nirgends mehr auf der Seite
  await expect(bereich.getByRole("textbox", { name: "Neuer Link" })).toHaveCount(0);

  await links.getByRole("button", { name: "Widerrufen" }).click();
  await expect(links).toHaveCount(0);
  expect((await fremd.get(url)).status()).toBe(404);
  await fremd.dispose();
});
