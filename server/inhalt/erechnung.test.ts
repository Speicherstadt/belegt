import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eRechnungLesen, inCent } from "./erechnung.ts";

const beispiel = (name: string) => readFileSync(new URL(`./beispiele/${name}`, import.meta.url), "utf8");

describe("E-Rechnung lesen", () => {
  it("liest die Kopfdaten einer CII-Rechnung (ZUGFeRD, Factur-X)", () => {
    expect(eRechnungLesen(beispiel("cii.xml"))).toEqual({
      syntax: "cii",
      nummer: "RE-2026-0042",
      datum: "2026-03-15",
      typ: "380",
      verkaeufer: "Muster & Co. KG",
      kaeufer: "Anna Beispiel",
      bruttoCent: 11900,
      waehrung: "EUR",
    });
  });

  it("liest die Kopfdaten einer UBL-Rechnung (XRechnung), Name aus PartyLegalEntity", () => {
    expect(eRechnungLesen(beispiel("ubl.xml"))).toEqual({
      syntax: "ubl",
      nummer: "2026/77",
      datum: "2026-04-02",
      typ: "380",
      verkaeufer: "Werkstatt Beispiel GmbH",
      kaeufer: "Stadt Musterstadt",
      bruttoCent: 119060,
      waehrung: "EUR",
    });
  });

  it("erkennt eine UBL-Gutschrift und lehnt anderes XML und Kaputtes ab", () => {
    const gutschrift = beispiel("ubl.xml")
      .replaceAll("ubl:Invoice", "ubl:CreditNote")
      .replace(":Invoice-2", ":CreditNote-2")
      .replaceAll("InvoiceTypeCode>380", "CreditNoteTypeCode>381");
    expect(eRechnungLesen(gutschrift)).toMatchObject({ syntax: "ubl", typ: "381", nummer: "2026/77" });
    expect(eRechnungLesen("<rss><channel/></rss>")).toBeNull();
    expect(eRechnungLesen("<<kein xml")).toBeNull();
  });

  it("löst nur vordefinierte Entitäten und Zeichenreferenzen auf", () => {
    const xml = beispiel("ubl.xml").replace(
      "Werkstatt Beispiel GmbH",
      "M&#252;ller &lt;Werkstatt&gt; &#x26; &quot;S&#246;hne&quot; &unbekannt;",
    );
    expect(eRechnungLesen(xml)?.verkaeufer).toBe('Müller <Werkstatt> & "Söhne" &unbekannt;');
  });

  it("rechnet Beträge ohne Fließkomma in Cent", () => {
    expect(inCent("119.00")).toBe(11900);
    expect(inCent("0.1")).toBe(10);
    expect(inCent("-5.5")).toBe(-550);
    expect(inCent("12")).toBe(1200);
    expect(inCent("1.230")).toBe(123);
    expect(inCent("1.234")).toBeNull();
    expect(inCent("1,00")).toBeNull();
    expect(inCent(null)).toBeNull();
    expect(inCent("99999999999.99")).toBe(9999999999999);
  });

  it("nimmt kein Rechnungsdatum, das es nicht gibt (BT-2)", () => {
    const ubl = (tag: string) => `<Invoice><ID>1</ID><IssueDate>${tag}</IssueDate></Invoice>`;
    expect(eRechnungLesen(ubl("2026-13-45"))?.datum).toBeNull();
    expect(eRechnungLesen(ubl("2026-02-30"))?.datum).toBeNull();
    expect(eRechnungLesen(ubl("2028-02-29"))?.datum).toBe("2028-02-29");
    const cii = `<CrossIndustryInvoice><ExchangedDocument><IssueDateTime><DateTimeString>20250229</DateTimeString></IssueDateTime></ExchangedDocument></CrossIndustryInvoice>`;
    expect(eRechnungLesen(cii)?.datum).toBeNull();
  });
});
