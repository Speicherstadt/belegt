import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Nachweis } from "./nachweis.ts";

const zeit = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(
    new Date(iso),
  );

const AKTION: Record<string, string> = { INSERT: "angelegt", UPDATE: "geändert", DELETE: "entfernt" };

/** Nimmt nur Zeichen, die die Standardschrift (WinAnsi) kennt; alles andere wird ein Fragezeichen */
const druckbar = (text: string) => text.replace(/[^\x20-\x7E\xA0-\xFF„“‚‘–—…€]/g, "?");

/**
 * Der Nachweis als PDF auf einer oder mehreren A4-Seiten: Angaben zum Original, Hash, Siegel, Zeitstempel, Prüfung der
 * Kette und der Verlauf. Der Hash steht auch in den Stichwörtern des PDFs, damit ein Programm ihn findet
 */
export async function nachweisPdf(n: Nachweis): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Nachweis ${n.dokument.dateiname ?? n.dokument.id}`);
  doc.setKeywords([n.dokument.sha256, `ASN ${n.dokument.asn}`]);
  doc.setProducer("Belegt");
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  let seite = doc.addPage([595, 842]);
  let y = 790;
  const zeile = (text: string, { font = normal, groesse = 10, abstand = 15, grau = false } = {}) => {
    if (y < 60) {
      seite = doc.addPage([595, 842]);
      y = 790;
    }
    seite.drawText(druckbar(text), {
      x: 50,
      y,
      size: groesse,
      font,
      color: grau ? rgb(0.35, 0.35, 0.4) : rgb(0, 0, 0),
    });
    y -= abstand;
  };
  const absatz = () => {
    y -= 8;
  };

  zeile("Nachweis über ein Original", { font: fett, groesse: 18, abstand: 26 });
  zeile(`Erstellt am ${zeit(new Date().toISOString())} von Belegt`, { grau: true });
  absatz();
  zeile("Das Original", { font: fett, groesse: 12, abstand: 18 });
  zeile(`Dateiname: ${n.dokument.dateiname ?? "-"}`);
  zeile(`Archivnummer (ASN): ${n.dokument.asn}`);
  zeile(`Eingegangen: ${zeit(n.dokument.eingegangenAm)} (Eintrag Nr. ${n.eingangSeq} im Audit-Log)`);
  zeile(`Größe: ${n.dokument.groesse} Byte`);
  zeile("SHA-256 des Originals:");
  zeile(n.dokument.sha256, { font: mono, groesse: 9 });
  zeile("Siegel der Zeile:");
  zeile(n.siegel ?? "-", { font: mono, groesse: 9 });
  absatz();
  zeile("Was das belegt", { font: fett, groesse: 12, abstand: 18 });
  zeile(
    n.zeitstempel
      ? `Zeitstempel: spätestens am ${zeit(n.zeitstempel.zeit)} lag es so vor (${n.zeitstempel.dienst}, Nr. ${n.zeitstempel.seriennummer}, Kette bis Nr. ${n.zeitstempel.seq}).`
      : "Zeitstempel: noch keiner nach dem Eingang.",
  );
  zeile(
    n.pruefung
      ? `Prüfung der Hash-Kette am ${zeit(n.pruefung.geprueftAm)}: ${n.pruefung.ok ? "ohne Befund" : `${n.pruefung.befunde} Befunde`}.`
      : "Prüfung der Hash-Kette: noch keine.",
  );
  zeile("Wer den SHA-256 einer Datei berechnet und er gleicht dem oben, hält dasselbe Original in der Hand.", {
    grau: true,
  });
  absatz();
  zeile("Verlauf", { font: fett, groesse: 12, abstand: 18 });
  for (const e of n.ereignisse)
    zeile(
      `Nr. ${e.seq}  ${zeit(e.at)}  ${e.tabelle} ${AKTION[e.aktion] ?? e.aktion}${e.detail ? `: ${e.detail}` : ""}  (${e.akteur ?? "-"})`,
      { groesse: 9, abstand: 13 },
    );
  return doc.save();
}
