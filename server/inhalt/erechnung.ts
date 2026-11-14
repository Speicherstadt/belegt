import { XMLParser } from "fast-xml-parser";

/**
 * Liest die Kopfdaten einer E-Rechnung nach EN 16931 in ihren beiden Syntaxen: UN/CEFACT CII
 * (CrossIndustryInvoice, auch in ZUGFeRD und Factur-X) und OASIS UBL (Invoice, CreditNote; XRechnung). Nur was
 * Belegt für die Einordnung braucht; geprüft wird die Rechnung damit nicht. Beträge in ganzen Cent.
 */
export interface ERechnung {
  syntax: "cii" | "ubl";
  /** BT-1 */
  nummer: string | null;
  /** BT-2, JJJJ-MM-TT */
  datum: string | null;
  /** BT-3: 380 Rechnung, 381 Gutschrift, … */
  typ: string | null;
  /** BT-27 */
  verkaeufer: string | null;
  /** BT-44 */
  kaeufer: string | null;
  /** BT-112, Gesamtbetrag mit Umsatzsteuer, in Cent */
  bruttoCent: number | null;
  /** BT-5 */
  waehrung: string | null;
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  // Keine Entitäten auflösen: eine E-Rechnung braucht keine, und so bleibt es bei dem, was in der Datei steht
  processEntities: false,
  htmlEntities: false,
});

type Knoten = Record<string, unknown> | undefined;

/** Folgt einem Pfad; bei mehrfachen Elementen das erste, bei Text den Text */
function pfad(k: unknown, ...namen: string[]): unknown {
  let jetzt = k;
  for (const n of namen) {
    if (Array.isArray(jetzt)) jetzt = jetzt[0];
    if (!jetzt || typeof jetzt !== "object") return undefined;
    jetzt = (jetzt as Record<string, unknown>)[n];
  }
  return Array.isArray(jetzt) ? jetzt[0] : jetzt;
}

const VORDEFINIERT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Die fünf vordefinierten Entitäten und Zeichenreferenzen von XML; Entitäten aus einer DTD bleiben unaufgelöst */
const entitaeten = (t: string) =>
  t.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (ganz, e: string) => {
    if (e.startsWith("#")) {
      const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ganz;
    }
    return VORDEFINIERT[e] ?? ganz;
  });

const text = (k: unknown): string | null => {
  const t = typeof k === "string" || typeof k === "number" ? entitaeten(String(k)).trim() : null;
  return t ? t.slice(0, 300) : null;
};

/** Dezimalzahl als Text in Cent, ohne Fließkomma; mehr als zwei Nachkommastellen nur, wenn sie null sind */
export function inCent(wert: string | null): number | null {
  const t = wert?.trim().match(/^([+-])?(\d{1,13})(?:\.(\d+))?$/);
  if (!t) return null;
  const [, vorzeichen, ganz, bruch = ""] = t;
  if (/[1-9]/.test(bruch.slice(2))) return null;
  const cent = Number(ganz) * 100 + Number(bruch.slice(0, 2).padEnd(2, "0"));
  return vorzeichen === "-" ? -cent : cent;
}

/** CII-Datum im Format 102 (JJJJMMTT) oder schon JJJJ-MM-TT */
function datum(wert: string | null): string | null {
  const t = wert?.trim();
  if (!t) return null;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function cii(r: Knoten): ERechnung {
  const handel = pfad(r, "SupplyChainTradeTransaction");
  const vereinbarung = pfad(handel, "ApplicableHeaderTradeAgreement");
  const abrechnung = pfad(handel, "ApplicableHeaderTradeSettlement");
  return {
    syntax: "cii",
    nummer: text(pfad(r, "ExchangedDocument", "ID")),
    datum: datum(text(pfad(r, "ExchangedDocument", "IssueDateTime", "DateTimeString"))),
    typ: text(pfad(r, "ExchangedDocument", "TypeCode")),
    verkaeufer: text(pfad(vereinbarung, "SellerTradeParty", "Name")),
    kaeufer: text(pfad(vereinbarung, "BuyerTradeParty", "Name")),
    bruttoCent: inCent(text(pfad(abrechnung, "SpecifiedTradeSettlementHeaderMonetarySummation", "GrandTotalAmount"))),
    waehrung: text(pfad(abrechnung, "InvoiceCurrencyCode")),
  };
}

function ubl(r: Knoten, gutschrift: boolean): ERechnung {
  const partei = (rolle: string) => {
    const p = pfad(r, rolle, "Party");
    return text(pfad(p, "PartyLegalEntity", "RegistrationName")) ?? text(pfad(p, "PartyName", "Name"));
  };
  return {
    syntax: "ubl",
    nummer: text(pfad(r, "ID")),
    datum: datum(text(pfad(r, "IssueDate"))),
    typ: text(pfad(r, gutschrift ? "CreditNoteTypeCode" : "InvoiceTypeCode")),
    verkaeufer: partei("AccountingSupplierParty"),
    kaeufer: partei("AccountingCustomerParty"),
    bruttoCent: inCent(text(pfad(r, "LegalMonetaryTotal", "TaxInclusiveAmount"))),
    waehrung: text(pfad(r, "DocumentCurrencyCode")),
  };
}

/** Die E-Rechnung in einem XML-Dokument oder null, wenn es keine ist oder sich nicht lesen lässt */
export function eRechnungLesen(xml: string): ERechnung | null {
  let wurzel: Record<string, unknown>;
  try {
    wurzel = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (wurzel.CrossIndustryInvoice) return cii(wurzel.CrossIndustryInvoice as Knoten);
  if (wurzel.Invoice) return ubl(wurzel.Invoice as Knoten, false);
  if (wurzel.CreditNote) return ubl(wurzel.CreditNote as Knoten, true);
  return null;
}
