import { PDFDocument, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { type CodeBild, codeSchreiben } from "./barcode.ts";

/** Vorgabe für TRENNBLATT_CODE */
export const TRENNBLATT_CODE = "BELEGT-TRENNER";

/** Zeichnet die schwarzen Module eines Codes als Rechtecke: scharf in jeder Druckauflösung */
function zeichnen(seite: PDFPage, s: CodeBild, x: number, y: number, modulBreite: number, modulHoehe: number) {
  for (let zeile = 0; zeile < s.height; zeile++) {
    for (let spalte = 0; spalte < s.width; spalte++) {
      if (s.data[zeile * s.width + spalte] !== 0) continue;
      seite.drawRectangle({
        x: x + spalte * modulBreite,
        y: y + (s.height - 1 - zeile) * modulHoehe,
        width: modulBreite,
        height: modulHoehe,
        color: rgb(0, 0, 0),
      });
    }
  }
}

const cache = new Map<string, Promise<Uint8Array>>();

/**
 * Ein Trennblatt (A4) mit dem Code als QR-Code und als Code 128 und einem Hinweis auf Deutsch und Englisch. Es kommt
 * zwischen die Belege eines Stapels; Belegt teilt den Scan an dieser Seite und archiviert sie nicht.
 */
export function trennblattPdf(code: string = TRENNBLATT_CODE): Promise<Uint8Array> {
  let pdf = cache.get(code);
  if (!pdf) {
    pdf = erzeugen(code);
    cache.set(code, pdf);
    pdf.catch(() => cache.delete(code));
  }
  return pdf;
}

async function erzeugen(code: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Belegt – Trennblatt");
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const [breite, hoehe] = [595.28, 841.89];
  const seite = doc.addPage([breite, hoehe]);
  const mitte = (text: string, y: number, groesse: number, font = normal) =>
    seite.drawText(text, { x: (breite - font.widthOfTextAtSize(text, groesse)) / 2, y, size: groesse, font });

  mitte("Trennblatt", hoehe - 110, 40, fett);
  mitte("Separator sheet", hoehe - 145, 20);

  const qr = await codeSchreiben(code, "QRCode");
  const qrMass = 240;
  zeichnen(seite, qr, (breite - qrMass) / 2, hoehe - 430, qrMass / qr.width, qrMass / qr.height);

  const strich = await codeSchreiben(code, "Code128");
  const strichBreite = Math.min(380, strich.width * 2);
  zeichnen(seite, strich, (breite - strichBreite) / 2, 250, strichBreite / strich.width, 70 / strich.height);
  mitte(code, 228, 12);

  mitte("Lege dieses Blatt zwischen die Belege eines Stapels. Belegt teilt den Scan an dieser Seite;", 160, 11);
  mitte("das Trennblatt selbst wird nicht archiviert.", 145, 11);
  mitte("Put this sheet between the documents of a stack. Belegt splits the scan at this page;", 115, 10);
  mitte("the separator sheet itself is not archived.", 101, 10);
  return doc.save();
}
