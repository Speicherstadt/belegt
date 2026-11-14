import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("die Prüfung lädt den Datenträger (Z3) für einen Zeitraum als ZIP", async ({ page }) => {
  await page.goto("/pruefung");
  const bereich = page.getByRole("region", { name: "Datenträger für die Betriebsprüfung (Z3)" });
  await bereich.getByLabel("Von").fill("2026-12-31");
  await bereich.getByLabel("Bis").fill("2026-01-01");
  await expect(bereich.getByRole("alert")).toHaveText("Der Beginn muss vor dem Ende liegen.");
  await bereich.getByLabel("Von").fill("2026-01-01");
  await bereich.getByLabel("Bis").fill("2026-12-31");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    bereich.getByRole("link", { name: "ZIP herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("belegt-z3-2026-01-01-2026-12-31.zip");
  const bytes = await readFile((await download.path())!);
  // Lokaler Dateikopf eines ZIP
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
});
