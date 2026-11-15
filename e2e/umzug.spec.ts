import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { zipSync } from "fflate";

/* Umzug aus Paperless-ngx gegen das nachgebaute Paperless-ngx aus e2e/server.ts (Port 3186) */

const axe = (page: Page) =>
  new AxeBuilder({ page }).exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function hellUndDunkel(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await axe(page)).violations, colorScheme).toEqual([]);
  }
}

/** Ein selbst gebauter Export mit einem Dokument, je Projekt ein anderes Original */
function exportZip(projekt: string): Buffer {
  const original = new TextEncoder().encode(`Paperless E2E Export ${projekt}`);
  const manifest = [
    { model: "documents.tag", pk: 1, fields: { name: `Export ${projekt}` } },
    {
      model: "documents.document",
      pk: 1,
      fields: {
        title: `Versicherung ${projekt}`,
        tags: [1],
        created: "2026-02-01",
        original_filename: `paperless-export-${projekt}.bin`,
        checksum: createHash("sha256").update(original).digest("hex"),
        deleted_at: null,
      },
      __exported_file_name__: "originals/versicherung.bin",
    },
  ];
  return Buffer.from(
    zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "originals/versicherung.bin": original,
    }),
  );
}

test("Paperless-ngx über die API und aus einem Export übernehmen", async ({ page }, info) => {
  const projekt = info.project.name;
  await page.goto("/quellen");
  const umzug = page.locator("section", { has: page.getByRole("heading", { name: "Umzug aus Paperless-ngx" }) });

  await umzug.getByLabel("Aus Paperless-ngx").selectOption("tag");
  await umzug.getByLabel("Name in Paperless-ngx").fill(`Vertrag ${projekt}`);
  await umzug.getByLabel("Art in Belegt").selectOption("geschaeftsbrief");
  await umzug.getByRole("button", { name: "Zuordnung anlegen" }).click();
  await expect(umzug.getByText(`Tag „Vertrag ${projekt}“ → Handels- und Geschäftsbriefe`)).toBeVisible();
  await hellUndDunkel(page);
  await umzug.getByRole("button", { name: `Zuordnung „Vertrag ${projekt}“ entfernen` }).click();
  await expect(umzug.getByText(`Tag „Vertrag ${projekt}“`)).toHaveCount(0);

  await umzug.getByLabel("Name", { exact: true }).fill(`Alt ${projekt}`);
  await umzug.getByLabel("Adresse").fill("http://127.0.0.1:3186");
  await umzug.getByLabel("API-Token").fill("e2e-paperless-token");
  await umzug.getByRole("button", { name: "Paperless-ngx verbinden" }).click();
  await umzug
    .getByRole("listitem")
    .filter({ hasText: `Alt ${projekt} · http://127.0.0.1:3186` })
    .getByRole("button", { name: "Import starten" })
    .click();
  const lauf = umzug.getByRole("listitem").filter({ hasText: `Alt ${projekt} über die API` });
  // Im zweiten Projekt liegen die Originale schon im Archiv und werden nur verknüpft
  await expect(lauf).toContainText("2 von 2 übernommen, 0 Fehler", { timeout: 30_000 });
  await expect(lauf).toContainText("fertig");

  await page.getByTestId("paperless-export").setInputFiles({
    name: `export-${projekt}.zip`,
    mimeType: "application/zip",
    buffer: exportZip(projekt),
  });
  const ausExport = umzug.getByRole("listitem").filter({ hasText: `Export export-${projekt}.zip` });
  await expect(ausExport).toContainText("1 von 1 übernommen, 0 Fehler", { timeout: 30_000 });
  await expect(ausExport).toContainText("fertig");
  await hellUndDunkel(page);

  await page.goto("/eingang");
  const exportZeile = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: `paperless-export-${projekt}.bin` }) });
  await expect(exportZeile).toContainText(`Export ${projekt}`);
  const zeile = page.getByRole("row").filter({ has: page.getByRole("link", { name: "paperless-strom.bin" }) });
  await expect(zeile).toContainText("Strom");
  await zeile.getByRole("link", { name: "paperless-strom.bin" }).click();
  await expect(page.getByText("Importiert", { exact: true })).toBeVisible();
  const einordnung = page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) });
  await expect(einordnung).toContainText("Aus Paperless-ngx: Strom März · Stadtwerke Beispiel ·");
  await einordnung.getByRole("button", { name: "Übernehmen" }).click();
  await expect(einordnung.getByLabel("Titel (optional)")).toHaveValue("Strom März");
  await expect(einordnung.getByLabel("Entstanden, empfangen oder abgesandt am")).toHaveValue("2026-03-01");
  await hellUndDunkel(page);
});
