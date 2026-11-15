import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { ausfuehren } from "../inhalt/ocr.ts";

/*
 * Seiten als kleine Bilder: pdftoppm (Poppler, im Image wie für die Texterkennung) rastert eine Seite eines PDFs als
 * JPEG. Bilder (JPEG, PNG) bettet pdf-lib vorher in ein PDF mit einer Seite in Bildgröße; so braucht Belegt keine
 * weitere native Bibliothek zum Verkleinern. WebP, TIFF und HEIC kann pdf-lib nicht einbetten, sie bekommen kein Bild.
 */

/** Bilder, die sich verkleinern lassen */
export const BILDER = ["image/jpeg", "image/png"];

let verfuegbar: boolean | undefined;
/** Ob pdftoppm installiert ist; ohne gibt es keine Vorschaubilder und keine Seitenbilder */
export const rasterVerfuegbar = () => (verfuegbar ??= spawnSync("pdftoppm", ["-v"], { stdio: "ignore" }).status === 0);

/** Ein PDF mit einer Seite in der Größe des Bildes (1 px = 1 pt) */
export async function bildAlsPdf(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const bild = mimeType === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  pdf.addPage([bild.width, bild.height]).drawImage(bild, { x: 0, y: 0, width: bild.width, height: bild.height });
  return pdf.save();
}

/**
 * Seite (ab 1) eines PDFs als JPEG, breite Pixel breit; pdftoppm als eigener Prozess mit Zeitlimit. Höher als viermal
 * die Breite wird das Bild nicht (von oben abgeschnitten): pdftoppm legt das ganze Raster im Speicher an, und eine
 * schmale, lange Seite (5 × 14400 pt) bräuchte sonst über 1 GB.
 */
export async function seiteAlsJpeg(
  pdf: Uint8Array,
  { seite = 1, breite = 300, zeitlimit = 60_000 }: { seite?: number; breite?: number; zeitlimit?: number } = {},
): Promise<Uint8Array> {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-bild-"));
  try {
    await writeFile(join(ordner, "d.pdf"), pdf);
    await ausfuehren(
      "pdftoppm",
      [
        ...["-f", String(seite), "-l", String(seite)],
        ...["-scale-to-x", String(breite), "-scale-to-y", "-1"],
        ...["-x", "0", "-y", "0", "-W", String(breite), "-H", String(breite * 4)],
        ...["-jpeg", "-jpegopt", "quality=75", "-singlefile"],
        join(ordner, "d.pdf"),
        join(ordner, "seite"),
      ],
      undefined,
      zeitlimit,
    );
    return new Uint8Array(await readFile(join(ordner, "seite.jpg")));
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

/** Seitenzahl eines PDFs mit pdfinfo (Poppler), ohne das PDF in diesem Prozess zu öffnen */
export async function seitenzahl(pdf: Uint8Array, zeitlimit = 30_000): Promise<number> {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-info-"));
  try {
    await writeFile(join(ordner, "d.pdf"), pdf);
    const info = await ausfuehren("pdfinfo", [join(ordner, "d.pdf")], undefined, zeitlimit);
    const seiten = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isInteger(seiten) || seiten < 1) throw new Error("Keine Seiten");
    return seiten;
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

const KIND = fileURLToPath(new URL("./raster-kind.ts", import.meta.url));

/**
 * Vorschaubild der ersten Seite: ein PDF direkt mit pdftoppm, ein Bild erst in einem eigenen Bun-Prozess mit Zeitlimit
 * in ein PDF gebettet (pdf-lib entpackt ein PNG ganz, das hielte bei einem riesigen Bild sonst den Worker auf).
 */
export async function vorschaubild(bytes: Uint8Array, mimeType: string, zeitlimit = 120_000): Promise<Uint8Array> {
  if (mimeType === "application/pdf") return seiteAlsJpeg(bytes, { zeitlimit });
  if (!BILDER.includes(mimeType)) throw new Error(`Kein Vorschaubild für ${mimeType}`);
  const aus = await ausfuehren("bun", [KIND, mimeType], bytes, zeitlimit);
  return new Uint8Array(Buffer.from(aus, "base64"));
}
