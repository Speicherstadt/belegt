import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/* Briefe als echte PDFs für die Bilder in README und Doku (e2e/screenshot-daten.ts) */

export interface Brief {
  absender: string;
  anschrift: string;
  titel: string;
  datum: string;
  zeilen: string[];
  posten?: [string, string][];
  summe?: string;
}

/** Ein einseitiges PDF wie ein Brief: Kopf, Betreff, Text, auf Wunsch Posten mit Summe; mit Text für die Suche */
export async function brief(b: Brief, anhang?: { name: string; xml: string }) {
  const pdf = await PDFDocument.create();
  const seite = pdf.addPage([595, 842]);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);
  const grau = rgb(0.35, 0.35, 0.4);
  seite.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: rgb(0.13, 0.4, 0.3) });
  seite.drawText(b.absender, { x: 56, y: 810, size: 16, font: fett, color: rgb(1, 1, 1) });
  seite.drawText(b.anschrift, { x: 56, y: 760, size: 8, font: normal, color: grau });
  seite.drawText("Muster Werkstatt GmbH", { x: 56, y: 730, size: 10, font: normal });
  seite.drawText("Musterweg 1, 12345 Musterstadt", { x: 56, y: 716, size: 10, font: normal });
  seite.drawText(b.datum, { x: 460, y: 716, size: 10, font: normal });
  seite.drawText(b.titel, { x: 56, y: 660, size: 14, font: fett });
  let y = 630;
  for (const zeile of b.zeilen) {
    seite.drawText(zeile, { x: 56, y, size: 10, font: normal });
    y -= 16;
  }
  if (b.posten) {
    y -= 14;
    for (const [text, betrag] of b.posten) {
      seite.drawText(text, { x: 56, y, size: 10, font: normal });
      seite.drawText(betrag, { x: 539 - normal.widthOfTextAtSize(betrag, 10), y, size: 10, font: normal });
      y -= 18;
    }
    seite.drawLine({ start: { x: 56, y: y + 8 }, end: { x: 539, y: y + 8 }, thickness: 0.5, color: grau });
    if (b.summe) {
      y -= 8;
      seite.drawText("Gesamtbetrag", { x: 56, y, size: 11, font: fett });
      seite.drawText(b.summe, { x: 539 - fett.widthOfTextAtSize(b.summe, 11), y, size: 11, font: fett });
    }
  }
  seite.drawText(`${b.absender} · ${b.anschrift}`, { x: 56, y: 40, size: 7, font: normal, color: grau });
  if (anhang) await pdf.attach(Buffer.from(anhang.xml), anhang.name, { mimeType: "text/xml" });
  return Buffer.from(await pdf.save());
}

/** ZUGFeRD-Rechnung (Profil EN 16931, CII) des Holzhandels, passend zum PDF */
export const CII = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>HK-2026-1187</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20261103</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Holzhandel Kranich GmbH</ram:Name></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Muster Werkstatt GmbH</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>1240.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">235.60</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>1475.60</ram:GrandTotalAmount>
        <ram:DuePayablesAmount>1475.60</ram:DuePayablesAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
