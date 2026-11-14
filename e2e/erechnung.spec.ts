import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const UBL = readFileSync(new URL("../server/inhalt/beispiele/ubl.xml", import.meta.url), "utf8");

test("eine XRechnung zeigt ihre Kopfdaten und füllt die Einordnung vor", async ({ page }, info) => {
  const name = `xrechnung-${info.project.name}.xml`;
  const nummer = `2026/E2E-${info.project.name}`;
  await page.goto("/");
  await page.getByTestId("upload").setInputFiles({
    name,
    mimeType: "application/xml",
    buffer: Buffer.from(UBL.replace("<cbc:ID>2026/77</cbc:ID>", `<cbc:ID>${nummer}</cbc:ID>`)),
  });
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  const id = (await link.getAttribute("href"))!.split("/").pop()!;
  // Der Worker (hier der E2E-Server) liest die Datei kurz nach dem Hochladen
  await expect
    .poll(async () => (await (await page.request.get(`/api/dokumente/${id}/inhalt`)).json())?.erechnung?.nummer)
    .toBe(nummer);

  await link.click();
  const kopf = page.getByRole("region", { name: "E-Rechnung" });
  await expect(kopf).toContainText(nummer);
  await expect(kopf).toContainText("Werkstatt Beispiel GmbH");
  await expect(kopf).toContainText("1.190,60 €");

  await page
    .getByText(`E-Rechnung erkannt: ${nummer} von Werkstatt Beispiel GmbH.`)
    .getByRole("button", { name: "Übernehmen" })
    .click();
  await expect(page.getByLabel("Entstanden, empfangen oder abgesandt am")).toHaveValue("2026-04-02");
  await expect(page.getByLabel("Titel (optional)")).toHaveValue(`Rechnung ${nummer}`);
  await expect(page.getByLabel("Korrespondent (optional)")).toHaveValue("Werkstatt Beispiel GmbH");
  await page.getByRole("button", { name: "Einordnen" }).click();
  await expect(
    page
      .getByRole("region", { name: "Einordnung" })
      .or(page.locator("section", { has: page.getByRole("heading", { name: "Einordnung" }) })),
  ).toContainText("31.12.2034");
});
