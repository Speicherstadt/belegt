import { randomBytes } from "node:crypto";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { srgbProfil } from "./icc.ts";

/*
 * Macht aus dem PDF, das Tesseract schreibt (je Seite das Bild und darüber der erkannte Text unsichtbar, Schrift
 * „GlyphLessFont“ eingebettet), ein PDF/A-2b (ISO 19005-2). Tesseract allein erfüllt es nicht: Es fehlen OutputIntent,
 * XMP-Metadaten und die Datei-ID, und vor „endstream“ fehlt das Zeilenende (veraPDF: 6.1.3, 6.1.7.1, 6.2.4.3, 6.6.2.1).
 * pdf-lib übernimmt die Seiten in ein neues Dokument, schreibt jeden Stream neu und ergänzt, was fehlt. Das reicht,
 * weil jede Seite nur Bilder in DeviceRGB oder DeviceGray (abgedeckt durch den sRGB-OutputIntent) und Text in
 * Darstellungsart 3 (unsichtbar) enthält; fremde PDF-Inhalte kommen nie hinein, Scans werden vorher gerastert.
 */

/** Programm in Producer und CreatorTool */
const PROGRAMM = "Belegt";

/** Datum für XMP (ISO 8601, UTC); dieselbe Sekunde wie im Info-Verzeichnis, wie 6.6.3 es verlangt */
const xmpDatum = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

function xmp(jetzt: Date): string {
  const datum = xmpDatum(jetzt);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdfaid:part>2</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
   <xmp:CreatorTool>${PROGRAMM}</xmp:CreatorTool>
   <xmp:CreateDate>${datum}</xmp:CreateDate>
   <xmp:ModifyDate>${datum}</xmp:ModifyDate>
   <pdf:Producer>${PROGRAMM}</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Das PDF von Tesseract als PDF/A-2b; jetzt für Erzeugungsdatum in Info und XMP */
export async function alsPdfA(tesseractPdf: Uint8Array, jetzt = new Date()): Promise<Uint8Array> {
  const quelle = await PDFDocument.load(tesseractPdf, { updateMetadata: false });
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const seite of await pdf.copyPages(quelle, quelle.getPageIndices())) pdf.addPage(seite);

  // Sekunden genügen; XMP und Info müssen gleich sein
  const zeit = new Date(Math.floor(jetzt.getTime() / 1000) * 1000);
  pdf.setProducer(PROGRAMM);
  pdf.setCreator(PROGRAMM);
  pdf.setCreationDate(zeit);
  pdf.setModificationDate(zeit);

  const { context, catalog } = pdf;
  // Metadaten ungefiltert, damit sie auch ohne PDF-Leser lesbar bleiben
  const metadaten = context.stream(new TextEncoder().encode(xmp(zeit)), { Type: "Metadata", Subtype: "XML" });
  catalog.set(PDFName.of("Metadata"), context.register(metadaten));

  const profil = context.flateStream(srgbProfil(), { N: 3 });
  const intent = context.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: context.register(profil),
  });
  catalog.set(PDFName.of("OutputIntents"), context.obj([intent]));

  // Datei-ID (6.1.3): zweimal derselbe Zufallswert, die Datei wird nie fortgeschrieben
  const id = PDFHexString.of(randomBytes(16).toString("hex"));
  context.trailerInfo.ID = context.obj([id, id]);
  return pdf.save();
}
