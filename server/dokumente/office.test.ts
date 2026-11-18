import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen, lesen } from "../inhalt/inhalt.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { dateityp } from "./dateityp.ts";
import { OFFICE_TYPEN, officeText, officeTyp } from "./office.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const typen = strToU8(
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
);

/** Ein Word-Dokument, so knapp wie es Word gerade noch öffnet */
const docx = (...absaetze: string[]) =>
  zipSync({
    "[Content_Types].xml": typen,
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document ${W}><w:body>${absaetze.map((a) => `<w:p><w:r><w:t>${a}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
    ),
    "word/footer1.xml": strToU8(`<w:ftr ${W}><w:p><w:r><w:t>Fußzeile Muster GmbH</w:t></w:r></w:p></w:ftr>`),
  });

const xlsx = () =>
  zipSync({
    "[Content_Types].xml": typen,
    "xl/workbook.xml": strToU8("<workbook/>"),
    "xl/sharedStrings.xml": strToU8("<sst><si><t>Kostenstelle</t></si><si><t>Büromiete März</t></si></sst>"),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>1250.5</v></c></row></sheetData></worksheet>',
    ),
  });

const pptx = () =>
  zipSync({
    "[Content_Types].xml": typen,
    "ppt/presentation.xml": strToU8("<p:presentation/>"),
    "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:r><a:t>Zweite Folie</a:t></a:r></a:p></p:sld>"),
    "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>Jahresplanung 2027</a:t></a:r></a:p></p:sld>"),
  });

/** OpenDocument: mimetype zuerst und unkomprimiert, wie es ODF verlangt */
const odt = () =>
  zipSync(
    {
      mimetype: [strToU8(OFFICE_TYPEN.odt), { level: 0 }],
      "content.xml": strToU8(
        "<office:document-content><office:body><office:text><text:h>Protokoll</text:h><text:p>Beschluss &amp; Vertrag über 3&#160;Jahre</text:p></office:text></office:body></office:document-content>",
      ),
    },
    {},
  );

describe("Text aus Office-Dateien", () => {
  it("erkennt den Typ am Inhalt, nicht an der Endung", () => {
    expect(officeTyp(docx("x"))).toBe(OFFICE_TYPEN.docx);
    expect(officeTyp(xlsx())).toBe(OFFICE_TYPEN.xlsx);
    expect(officeTyp(pptx())).toBe(OFFICE_TYPEN.pptx);
    expect(officeTyp(odt())).toBe(OFFICE_TYPEN.odt);
    expect(officeTyp(zipSync({ "bild.png": new Uint8Array([1, 2, 3]) }))).toBeNull();
    expect(officeTyp(strToU8("kein zip"))).toBeNull();
  });

  it("liest Absätze, Kopf- und Fußzeilen, Zellen und Folien in Reihenfolge, mit Umlauten und Entitäten", () => {
    expect(officeText(docx("Rechnung Nr. 42", "Betrag &amp; Steuer"), OFFICE_TYPEN.docx)).toBe(
      "Rechnung Nr. 42\nBetrag & Steuer\n\nFußzeile Muster GmbH",
    );
    const tabelle = officeText(xlsx(), OFFICE_TYPEN.xlsx);
    expect(tabelle).toContain("Büromiete März");
    expect(tabelle).toContain("1250.5");
    expect(officeText(pptx(), OFFICE_TYPEN.pptx)).toBe("Jahresplanung 2027\n\nZweite Folie");
    expect(officeText(odt(), OFFICE_TYPEN.odt)).toBe("Protokoll\nBeschluss & Vertrag über 3 Jahre");
  });

  it("entpackt keine ZIP-Bombe", () => {
    const bombe = zipSync({
      "[Content_Types].xml": typen,
      "word/document.xml": [new Uint8Array(60 * 1024 * 1024), { level: 9 }],
    });
    expect(bombe.length).toBeLessThan(1024 * 1024);
    expect(() => officeText(bombe, OFFICE_TYPEN.docx)).toThrow("entpackt zu groß");
  });

  it("hängt nicht an einem ZIP, das Milliarden Einträge behauptet", () => {
    // 102 Bytes: ZIP64-Verzeichnisende (APPNOTE 4.3.14) mit 2^32 - 1 Einträgen, aber keinem einzigen
    const b = new Uint8Array(4 + 56 + 20 + 22);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint32(4, 0x06064b50, true);
    v.setUint32(4 + 32, 0xffffffff, true);
    v.setUint32(60, 0x07064b50, true);
    v.setUint32(60 + 8, 4, true);
    v.setUint32(80, 0x06054b50, true);
    v.setUint16(80 + 8, 0xffff, true);
    const start = performance.now();
    expect(officeTyp(b)).toBeNull();
    expect(() => officeText(b, OFFICE_TYPEN.docx)).toThrow("zu viele Einträge");
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("erkennt Text und liest auch ältere Dokumente, die als unbekannte Datei gespeichert sind", async () => {
    expect(dateityp(strToU8("Name;Betrag\nMiete;1250,50\n"))).toBe("text/plain");
    expect(dateityp(new Uint8Array([0x00, 0x01, 0xff, 0xfe]))).toBe("application/octet-stream");
    expect(dateityp(docx("x"))).toBe(OFFICE_TYPEN.docx);
    expect((await lesen(docx("Altbestand"), "application/octet-stream")).text).toContain("Altbestand");
  });
});

describe.skipIf(!testDatenbankUrl)("Office-Dateien im Archiv gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("speichert den richtigen Typ und findet Wörter aus dem Inhalt", async () => {
    const hoch = async (bytes: Uint8Array, name: string) => {
      const f = new FormData();
      f.append("datei", new File([new Uint8Array(bytes)], name));
      return (await (await t.anfrage("/api/dokumente", { method: "POST", body: f }, cookie)).json()) as {
        id: string;
        mimeType: string;
      };
    };
    // Endung absichtlich falsch: der Typ kommt aus dem Inhalt
    const word = await hoch(docx("Kündigung Wartungsvertrag Heizung"), "brief.bin");
    expect(word.mimeType).toBe(OFFICE_TYPEN.docx);
    const csv = await hoch(strToU8("Lieferant;Betrag\nHolzhandel Beispiel;480,00\n"), "liste.csv");
    expect(csv.mimeType).toBe("text/plain");

    const kurz = await hoch(strToU8("ok"), "kurz.txt");
    expect(kurz.mimeType).toBe("text/plain");
    expect(await inhalteErzeugen(t, { ocr: false })).toEqual({ gelesen: 3, fehler: 0 });
    // Wenig Text ist bei Textdateien kein Scan: auch mit OCR nicht in jedem Lauf neu lesen
    expect(await inhalteErzeugen(t, { ocr: true })).toEqual({ gelesen: 0, fehler: 0 });
    const suche = async (q: string) =>
      (await (await t.anfrage(`/api/dokumente?suche=${encodeURIComponent(q)}`, {}, cookie)).json()).map(
        (d: { id: string }) => d.id,
      );
    expect(await suche("Wartungsvertrag")).toEqual([word.id]);
    expect(await suche("Holzhandel")).toEqual([csv.id]);
  });
});
