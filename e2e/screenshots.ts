import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

/*
 * Bilder für README und Doku: erfundene Dokumente, Mails, Einordnungen, Tags, Dokumenttypen und Felder, dann je Seite
 * hell und dunkel nach docs/assets/. Läuft nur mit DOKU_SCREENSHOTS=1 (bun run screenshots), nicht in der CI.
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
  const xrechnung = await hoch("xrechnung-2026-77.xml", Buffer.from(UBL), "application/xml");
  await hoch("Scan-Tankquittung.pdf", pdf("Tankquittung"));
  await hoch("Scan-Bewirtung.pdf", pdf("Bewirtungsbeleg"));

  // Ordnung: Tags, Dokumenttypen und ein Betragsfeld, damit Liste und Dokument sie zeigen
  const anlegen = async (pfad: string, body: object) =>
    ((await (await r.post(pfad, json(body))).json()) as { id: string }).id;
  const steuer = await anlegen("/api/tags", { name: "Steuer 2026", farbe: "blau" });
  const fix = await anlegen("/api/tags", { name: "Fixkosten", farbe: "gruen" });
  const buero = await anlegen("/api/tags", { name: "Büro", farbe: "violett" });
  const rechnung = await anlegen("/api/dokumenttypen", { name: "Rechnung", vorgabeArt: "beleg" });
  const vertrag = await anlegen("/api/dokumenttypen", { name: "Vertrag", vorgabeArt: null });
  const betrag = await anlegen("/api/felder", { name: "Betrag", typ: "betrag" });
  const ordnen = (id: string, a: object) => r.post(`/api/dokumente/${id}/ordnung`, json(a));
  await ordnen(strom.id, {
    tagsHinzu: [steuer, fix],
    dokumenttyp: rechnung,
    felder: [{ feldId: betrag, wert: "84,20" }],
  });
  await ordnen(miete.id, { tagsHinzu: [fix, buero], dokumenttyp: vertrag });
  await ordnen(brief.id, { tagsHinzu: [buero] });
  await ordnen(xrechnung.id, { tagsHinzu: [steuer], dokumenttyp: rechnung });
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
      papierbelege: "Papier wird nach dem Scannen ein Jahr aufbewahrt.",
      ergaenzungen: "",
      rechtsform: "GmbH",
      aufbewahrungsort: "Server und Sicherungen im Büro in Musterstadt, Deutschland.",
      serverbetrieb: "Anna Muster betreibt den Server selbst und spielt Updates monatlich ein.",
      schluesselablage: "Im Tresor des Büros.",
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

  // Eingang mit Mehrfachauswahl: zwei Scans gewählt, darüber die Sammelbearbeitung; daneben „Foto aufnehmen“
  await page.goto("/eingang");
  await expect(page.getByRole("heading", { level: 1, name: "Eingang" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Foto aufnehmen" })).toBeVisible();
  for (const name of ["Scan-Tankquittung.pdf", "Scan-Bewirtung.pdf"])
    await page.getByRole("checkbox", { name: `${name} auswählen` }).check();
  await bild(page, "eingang");

  const x = page.getByRole("link", { name: "xrechnung-2026-77.xml" });
  await page.goto("/eingang");
  await x.click();
  await expect(page.getByRole("region", { name: "E-Rechnung" })).toBeVisible();
  await bild(page, "dokument");

  await page.goto("/fristen");
  await expect(page.getByRole("heading", { level: 1, name: "Fristen" })).toBeVisible();
  await bild(page, "fristen");

  await page.goto("/pruefung");
  await expect(page.getByRole("region", { name: "Prüfbericht" })).toBeVisible();
  await bild(page, "pruefung");

  // Startseite mit einer Kachel aus einer gespeicherten Ansicht
  const ansicht = await page.request.post("/api/ansichten", {
    data: { name: "Steuer 2026", parameter: { suche: "Rechnung" } },
  });
  await page.request.put("/api/start/kacheln", { data: { ansichten: [(await ansicht.json()).id] } });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Steuer 2026" })).toContainText("Dokumente");
  await expect(page.getByRole("region", { name: "Unveränderbarkeit" })).toContainText("in Ordnung");
  await bild(page, "start");
});
