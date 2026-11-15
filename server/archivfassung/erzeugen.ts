import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { dateityp } from "../dokumente/dateityp.ts";
import { ausfuehren, MAX_SEITEN, ocrSprachen } from "../inhalt/ocr.ts";
import { bildMasse } from "./bildmasse.ts";
import { alsPdfA } from "./pdfa.ts";

/*
 * Die Archivfassung eines Scans: Tesseract schreibt je Seite das Bild und den erkannten Text unsichtbar darüber in ein
 * PDF (Ausgabe „pdf“, ohne weitere Abhängigkeit im Image), pdfa.ts macht daraus PDF/A-2b. Ein Bild geht unverändert
 * an Tesseract (ein JPEG bettet es so ein, wie es ist); ein gescanntes PDF rastert pdftoppm vorher mit 300 dpi, damit
 * nur Bilder und Text in die Fassung kommen und sie sicher PDF/A bleibt (fremde Inhalte wie Schriften, Farbräume oder
 * Skripte des Originals kämen sonst mit). Vorher abgelehnt wird, was den Worker aufhalten könnte: mehr als MAX_SEITEN
 * Seiten oder mehr als MAX_BILDPUNKTE Bildpunkte auf einer Seite.
 */

/** Auflösung, mit der gescannte PDFs gerastert werden: wie für die Texterkennung (server/inhalt/ocr.ts) */
const DPI = 300;
/** Höchstens so viele Bildpunkte je Seite; A4 mit 300 dpi sind 8,7 Millionen, A2 35 Millionen */
export const MAX_BILDPUNKTE = 50_000_000;
/** Größer wird keine Archivfassung gespeichert */
export const MAX_ARCHIVFASSUNG = 50 * 1024 * 1024;

export interface Fassung {
  pdf: Uint8Array;
  seiten: number;
}

/** Seitengrößen in pt aus pdfinfo; mehr als MAX_SEITEN Seiten lehnt es ab, bevor etwas gerastert wird */
async function seitenPruefen(datei: string, zeitlimit: number): Promise<number> {
  const info = await ausfuehren("pdfinfo", ["-f", "1", "-l", String(MAX_SEITEN), datei], undefined, zeitlimit);
  const seiten = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  if (!Number.isInteger(seiten) || seiten < 1) throw new Error("Keine Seiten");
  if (seiten > MAX_SEITEN) throw new Error(`Zu viele Seiten (${seiten}, höchstens ${MAX_SEITEN})`);
  for (const [, nr, b, h] of info.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) {
    const punkte = ((Number(b) * DPI) / 72) * ((Number(h) * DPI) / 72);
    if (!(punkte <= MAX_BILDPUNKTE)) throw new Error(`Seite ${nr} zu groß (${b} × ${h} pt)`);
  }
  return seiten;
}

function bildPruefen(bytes: Uint8Array) {
  const masse = bildMasse(bytes);
  if (!masse || masse.breite < 1 || masse.hoehe < 1) throw new Error("Bildgröße nicht lesbar");
  if (masse.breite * masse.hoehe > MAX_BILDPUNKTE)
    throw new Error(`Bild zu groß (${masse.breite} × ${masse.hoehe} Bildpunkte)`);
}

/**
 * Archivfassung eines Bildes (JPEG, PNG, WebP) oder gescannten PDFs. Läuft im Kind (archiv-kind.ts); jedes Programm
 * bekommt das Zeitlimit, das Kind selbst beendet die Prozessgruppe nach demselben.
 */
export async function archivPdf(bytes: Uint8Array, gespeichert: string, zeitlimit = 10 * 60_000): Promise<Fassung> {
  const mimeType = gespeichert === "application/octet-stream" ? dateityp(bytes) : gespeichert;
  const ordner = await mkdtemp(join(tmpdir(), "belegt-archiv-"));
  try {
    let bilder: string[];
    let erwartet = 1;
    if (mimeType === "application/pdf") {
      await writeFile(join(ordner, "scan.pdf"), bytes);
      erwartet = await seitenPruefen(join(ordner, "scan.pdf"), zeitlimit);
      const r = ["-r", String(DPI), "-png", join(ordner, "scan.pdf"), join(ordner, "seite")];
      await ausfuehren("pdftoppm", r, undefined, zeitlimit);
      bilder = (await readdir(ordner)).filter((n) => n.startsWith("seite")).sort();
    } else if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      bildPruefen(bytes);
      await writeFile(join(ordner, "bild"), bytes);
      bilder = ["bild"];
    } else throw new Error(`Keine Archivfassung für ${mimeType}`);
    if (bilder.length !== erwartet) throw new Error("Nicht alle Seiten gerastert");

    // Eine Liste von Bildern ergibt bei Tesseract ein PDF mit einer Seite je Bild
    await writeFile(join(ordner, "liste.txt"), `${bilder.map((b) => join(ordner, b)).join("\n")}\n`);
    const argumente = [join(ordner, "liste.txt"), join(ordner, "aus"), "-l", ocrSprachen(), "pdf"];
    await ausfuehren("tesseract", argumente, undefined, zeitlimit);
    const pdf = await alsPdfA(new Uint8Array(await readFile(join(ordner, "aus.pdf"))));
    const seiten = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
    if (seiten !== erwartet) throw new Error(`Seitenzahl weicht ab (${seiten} statt ${erwartet})`);
    if (pdf.byteLength > MAX_ARCHIVFASSUNG) throw new Error("Archivfassung zu groß");
    return { pdf, seiten };
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}
