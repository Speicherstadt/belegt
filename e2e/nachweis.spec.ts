import { expect, test } from "@playwright/test";

test("Nachweis als PDF von der Dokumentseite herunterladen", async ({ page }, info) => {
  const name = `nachweis-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await page.getByRole("link", { name }).click();
  const link = page.getByRole("link", { name: "Nachweis (PDF)" });
  await expect(link).toHaveAttribute("href", /\/api\/dokumente\/[0-9a-f-]{36}\/nachweis\.pdf$/);
  const download = page.waitForEvent("download");
  await link.click();
  expect((await download).suggestedFilename()).toMatch(/^nachweis-asn-\d+\.pdf$/);
});
