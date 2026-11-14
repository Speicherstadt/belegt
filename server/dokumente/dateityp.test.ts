import { describe, expect, it } from "vitest";
import { type CfbEintrag, cfbDatei } from "../test-cfb.ts";
import { ALTE_OFFICE_TYPEN, dateityp } from "./dateityp.ts";

const strom = (name: string, daten?: Uint8Array): CfbEintrag => ({ name, typ: 2, daten });
const ablage = (name: string, kinder: CfbEintrag[]): CfbEintrag => ({ name, typ: 1, kinder });

/** Ein eingebettetes Word-Dokument (OLE-Objekt) als Storage mit seinen Streams */
const eingebettetesWord = (name: string) =>
  ablage(name, [strom("\u0001CompObj"), strom("WordDocument"), strom("1Table")]);

describe("Typ alter Office-Dateien", () => {
  it("erkennt Word, Excel und PowerPoint am Hauptstream unter der Wurzel", () => {
    expect(dateityp(cfbDatei([strom("1Table"), strom("WordDocument")]))).toBe(ALTE_OFFICE_TYPEN.doc);
    expect(dateityp(cfbDatei([strom("Workbook")]))).toBe(ALTE_OFFICE_TYPEN.xls);
    expect(dateityp(cfbDatei([strom("Book")]))).toBe(ALTE_OFFICE_TYPEN.xls);
    expect(dateityp(cfbDatei([strom("Current User"), strom("PowerPoint Document")]))).toBe(ALTE_OFFICE_TYPEN.ppt);
    expect(dateityp(cfbDatei([strom("EncryptedPackage")]))).toBe("application/octet-stream");
  });

  it("hält eine Excel-Datei mit eingebettetem Word-Dokument für Excel", () => {
    // [MS-XLS] 2.1.7.10: eingebettete Objekte liegen in Storages namens MBD…
    const xls = cfbDatei([strom("Workbook"), eingebettetesWord("MBD0012AB34")]);
    expect(dateityp(xls)).toBe(ALTE_OFFICE_TYPEN.xls);
  });

  it("hält eine Outlook-Mail (.msg) nicht für Word oder Excel, auch mit Word-Anhang oder dem Wort im Text", () => {
    // [MS-OXMSG] 2.2.2: ein angehängtes Dokument liegt als Storage im Storage des Anhangs
    const mitAnhang = cfbDatei([
      strom("__substg1.0_0037001F", Buffer.from("Vertrag", "utf16le")),
      ablage("__attach_version1.0_#00000000", [eingebettetesWord("__substg1.0_3701000D")]),
    ]);
    expect(dateityp(mitAnhang)).toBe("application/octet-stream");
    const text = cfbDatei([strom("__substg1.0_1000001F", Buffer.from("Anbei das Workbook für März", "utf16le"))]);
    expect(dateityp(text)).toBe("application/octet-stream");
  });
});
