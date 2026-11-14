import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/*
 * Bilder für README und Doku: erfundene Dokumente, Mails und Einordnungen, dann je Seite hell und dunkel nach
 * docs/assets/. Läuft nur mit DOKU_SCREENSHOTS=1 (bun run screenshots), nicht in der CI.
 */

const UBL = readFileSync(new URL("../server/inhalt/beispiele/ubl.xml", import.meta.url), "utf8");
const pdf = (text: string) => Buffer.from(`%PDF-1.7\n% ${text}\n`);
const json = (data: unknown) => ({ data });

async function vorbereiten(page: Page) {
  const r = page.request;
  const hoch = async (name: string, buffer: Buffer, mimeType = "application/pdf") =>
    (await (await r.post("/api/dokumente", { multipart: { datei: { name, mimeType, buffer } } })).json()) as {
      id: string;
    };
  const einordnen = (id: string, e: object) => r.post(`/api/dokumente/${id}/einordnung`, json(e));

  const strom = await hoch("Stadtwerke-Rechnung-Oktober.pdf", pdf("Rechnung Stadtwerke Musterstadt"));
  await einordnen(strom.id, {
    art: "beleg",
    entstanden: "2026-10-31",
    titel: "Strom Oktober",
    korrespondent: "Stadtwerke Musterstadt",
  });
  const miete = await hoch("Mietvertrag-Buero.pdf", pdf("Mietvertrag"));
  await einordnen(miete.id, {
    art: "freiwillig",
    entstanden: "2024-03-01",
    freiwilligBis: "2034-02-28",
    titel: "Mietvertrag Büro",
    korrespondent: "Hausverwaltung Beispiel",
  });
  const brief = await hoch("Angebot-Werkstatt.pdf", pdf("Angebot"));
  await einordnen(brief.id, {
    art: "geschaeftsbrief",
    entstanden: "2026-09-15",
    titel: "Angebot Werkstattausstattung",
    korrespondent: "Werkstatt Beispiel GmbH",
  });
  await hoch("xrechnung-2026-77.xml", Buffer.from(UBL), "application/xml");
  const eml = [
    "From: Buchhaltung <rechnung@lieferant.example>",
    "To: anna@example.org",
    "Subject: Ihre Rechnung RE-2026-0042",
    "Message-ID: <screenshot-1@lieferant.example>",
    "Date: Mon, 2 Nov 2026 09:12:00 +0100",
    "",
    "Guten Tag, anbei die Rechnung für Oktober.",
    "",
  ].join("\r\n");
  await r.post("/api/mails", {
    multipart: { datei: { name: "rechnung.eml", mimeType: "message/rfc822", buffer: Buffer.from(eml) } },
  });
  await r.post("/api/sperren", json({ grund: "Außenprüfung 2023", von: "2023-01-01", bis: "2023-12-31" }));
  await r.post(
    "/api/einstellungen",
    json({
      firma: "Muster Werkstatt GmbH",
      anschrift: "Musterweg 1, 12345 Musterstadt",
      verantwortlich: "Anna Muster",
      aufsicht: false,
      datensicherung: "Täglich verschlüsselt auf ein zweites Gerät, monatlich Wiederherstellung geprüft.",
      scannen: "Papier wird nach dem Scannen ein Jahr aufbewahrt.",
      ergaenzungen: "",
    }),
  );
  // Der E2E-Server liest Inhalte jede Sekunde; die XRechnung soll erkannt sein
  await expect
    .poll(async () => (await (await r.get("/api/dokumente?suche=Werkstatt")).json()).length)
    .toBeGreaterThan(1);
  return { strom };
}

async function bild(page: Page, name: string) {
  for (const schema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: schema });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/assets/screenshot-${name}${schema === "dark" ? "-dunkel" : ""}.png` });
  }
}

test("Bilder für README und Doku", async ({ page }) => {
  await vorbereiten(page);

  await page.goto("/archiv");
  await expect(page.getByRole("link", { name: "Strom Oktober" })).toBeVisible();
  await bild(page, "archiv");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await bild(page, "eingang");

  const x = page.getByRole("link", { name: "xrechnung-2026-77.xml" });
  await page.goto("/");
  await x.click();
  await expect(page.getByRole("region", { name: "E-Rechnung" })).toBeVisible();
  await bild(page, "dokument");

  await page.goto("/fristen");
  await expect(page.getByRole("heading", { level: 1, name: "Fristen" })).toBeVisible();
  await bild(page, "fristen");

  await page.goto("/pruefung");
  await expect(page.getByRole("region", { name: "Prüfbericht" })).toBeVisible();
  await bild(page, "pruefung");
});
