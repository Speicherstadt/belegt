import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Ein „Scan“ als PNG: Text auf weißem Grund, im Browser gezeichnet */
async function scanPng(page: Page, text: string): Promise<Buffer> {
  const daten = await page.evaluate((t) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = "64px sans-serif";
    ctx.fillText(t, 60, 220);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, text);
  return Buffer.from(daten, "base64");
}

test("ein Scan bekommt ein durchsuchbares PDF; die Seite sagt, dass das Original maßgeblich ist", async ({
  page,
}, info) => {
  test.slow();
  const name = `quittung-${info.project.name}.png`;
  await page.goto("/eingang");
  // Je Projekt eine eigene Datei: Dieselbe nimmt Belegt nur einmal auf, und Desktop und Handy teilen die Datenbank
  const png = Buffer.concat([await scanPng(page, "Quittung Werkstatt Beispiel"), Buffer.from(info.project.name)]);
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "image/png", buffer: png });
  const link = page.getByRole("link", { name });
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  // Der Worker (hier der E2E-Server) liest erst den Text, dann entsteht die Fassung; ohne Tesseract keine
  await expect
    .poll(async () => (await (await page.request.get(`/api/dokumente/${id}`)).json()).archivfassung, {
      timeout: 90_000,
    })
    .toBe(true);

  await link.click();
  const vorschau = page.getByRole("region", { name: "Vorschau" });
  await expect(vorschau).toContainText("Durchsuchbares PDF, aus dem Original erzeugt. Maßgeblich ist das Original.");
  await expect(vorschau.locator("iframe")).toHaveAttribute("src", `/api/dokumente/${id}/archivfassung`);
  await expect(page.getByRole("link", { name: "Original herunterladen" })).toHaveAttribute(
    "href",
    `/api/dokumente/${id}/datei`,
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Durchsuchbares PDF herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`quittung-${info.project.name} (durchsuchbar).pdf`);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const axe = await new AxeBuilder({ page })
      .exclude("iframe")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, colorScheme).toEqual([]);
  }
});
