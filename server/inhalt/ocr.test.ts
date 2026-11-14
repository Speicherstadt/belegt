import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { inhalteErzeugen, lesen } from "./inhalt.ts";
import { bildText, ocrVerfuegbar } from "./ocr.ts";

const TEXT = "Stromrechnung Oktober Müller";

/** Ein „Scan“: PDF mit Text, als PNG gerastert wie aus einem Scanner */
async function scanPng(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 300]).drawText(TEXT, { x: 40, y: 150, font, size: 32 });
  const ordner = mkdtempSync(join(tmpdir(), "belegt-scan-"));
  try {
    writeFileSync(join(ordner, "a.pdf"), await doc.save());
    execFileSync("pdftoppm", ["-r", "200", "-png", "-singlefile", join(ordner, "a.pdf"), join(ordner, "a")]);
    return new Uint8Array(readFileSync(join(ordner, "a.png")));
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

/** Ein gescanntes PDF: nur ein Bild, keine Textebene */
async function scanPdf(png: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bild = await doc.embedPng(png);
  doc.addPage([bild.width, bild.height]).drawImage(bild, { x: 0, y: 0 });
  return doc.save();
}

// Tesseract braucht je Seite einige Sekunden, neben den anderen Tests auch mehr
describe.skipIf(!ocrVerfuegbar())("Texterkennung (Tesseract)", { timeout: 60_000 }, () => {
  let png: Uint8Array;
  beforeAll(async () => {
    png = await scanPng();
  });

  it("liest Text aus einem Bild, mit Umlauten", async () => {
    expect(await bildText(png)).toContain(TEXT);
  });

  it("liest ein PDF ohne Textebene über die Texterkennung, aber nur mit ocr", async () => {
    const pdf = await scanPdf(png);
    expect(await lesen(pdf, "application/pdf")).toMatchObject({ text: expect.not.stringContaining("Strom") });
    const g = await lesen(pdf, "application/pdf", { ocr: true });
    expect(g.ocr).toBe(true);
    expect(g.text).toContain(TEXT);
  });

  describe.skipIf(!testDatenbankUrl)("im Archiv", () => {
    let t: Awaited<ReturnType<typeof testApp>>;
    let inhaber: string;
    beforeAll(async () => {
      t = await testApp();
      inhaber = (await t.registrieren("anna@example.org")).cookie;
    });
    afterAll(() => t?.aufraeumen());

    async function hochladen(bytes: Uint8Array, name: string) {
      const form = new FormData();
      form.append("datei", new File([new Uint8Array(bytes)], name));
      return (await (await t.anfrage("/api/dokumente", { method: "POST", body: form }, inhaber)).json()) as {
        id: string;
      };
    }
    const suche = async (q: string) =>
      (await (await t.anfrage(`/api/dokumente?suche=${encodeURIComponent(q)}`, {}, inhaber)).json()).map(
        (d: { id: string }) => d.id,
      );

    it("liest Scans nach, sobald die Texterkennung da ist, und macht sie durchsuchbar", async () => {
      const bild = await hochladen(png, "scan.png");
      const pdf = await hochladen(await scanPdf(png), "scan.pdf");

      // Ohne Texterkennung: das PDF ohne Text, das Bild gar nicht
      expect(await inhalteErzeugen(t, { ocr: false })).toEqual({ gelesen: 1, fehler: 0 });
      expect(await suche("Stromrechnung")).toEqual([]);

      expect(await inhalteErzeugen(t, { ocr: true })).toEqual({ gelesen: 2, fehler: 0 });
      expect((await suche("Stromrechnung")).sort()).toEqual([bild.id, pdf.id].sort());
      expect(await (await t.anfrage(`/api/dokumente/${bild.id}/inhalt`, {}, inhaber)).json()).toMatchObject({
        ocr: true,
      });

      // Einmal gelesen, nicht noch einmal
      expect(await inhalteErzeugen(t, { ocr: true })).toEqual({ gelesen: 0, fehler: 0 });
    });
  });
});
