import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Texterkennung mit Tesseract (Kommandozeile, wie bei vielen Archiven) und pdftoppm (Poppler) für gescannte PDFs.
 * Beide laufen als eigener Prozess mit Zeitlimit, damit eine schwere Datei den Worker nicht aufhält. Fehlen sie,
 * gibt es keinen Text aus Scans; alles andere läuft weiter.
 */

/** Sprachen für Tesseract, etwa „deu+eng“ */
export const ocrSprachen = () => process.env.OCR_SPRACHEN || "deu+eng";
/** Höchstens so viele Seiten eines gescannten PDFs */
export const MAX_SEITEN = 50;
const ZEITLIMIT = 120_000;
/** Auflösung, mit der gescannte PDFs gerastert werden (Texterkennung und Archivfassung) */
export const DPI = 300;
/** Höchstens so viele Bildpunkte je Seite; A4 mit 300 dpi sind 8,7 Millionen, A2 35 Millionen */
export const MAX_BILDPUNKTE = 50_000_000;

const vorhanden = (programm: string, schalter: string) =>
  spawnSync(programm, [schalter], { stdio: "ignore" }).status === 0;
let verfuegbar: boolean | undefined;
/** Ob Tesseract und pdftoppm installiert sind; einmal geprüft (pdftoppm kennt nur -v, nicht --version) */
export const ocrVerfuegbar = () => (verfuegbar ??= vorhanden("tesseract", "--version") && vorhanden("pdftoppm", "-v"));

/**
 * Startet ein Programm mit Eingabe auf stdin und gibt stdout zurück; nach dem Zeitlimit wird es beendet. Mit gruppe
 * läuft es in einer eigenen Prozessgruppe, und das Zeitlimit beendet auch die Programme, die es selbst startet (etwa
 * pdftoppm im Kind von teilenImKind); sonst rechneten die ohne Grenze weiter.
 */
export function ausfuehren(
  programm: string,
  argumente: string[],
  eingabe?: Uint8Array,
  zeitlimit = ZEITLIMIT,
  { gruppe = false }: { gruppe?: boolean } = {},
): Promise<string> {
  return new Promise((ok, fehler) => {
    const p = spawn(programm, argumente, { stdio: ["pipe", "pipe", "pipe"], detached: gruppe });
    let abgebrochen = false;
    const uhr = setTimeout(() => {
      abgebrochen = true;
      try {
        if (gruppe && p.pid) process.kill(-p.pid, "SIGKILL");
        else p.kill("SIGKILL");
      } catch {
        p.kill("SIGKILL");
      }
    }, zeitlimit);
    const aus: Buffer[] = [];
    let fehlertext = "";
    p.stdout.on("data", (d: Buffer) => aus.push(d));
    p.stderr.on("data", (d: Buffer) => {
      fehlertext = (fehlertext + d.toString()).slice(-500);
    });
    p.on("error", (err) => {
      clearTimeout(uhr);
      fehler(err);
    });
    p.on("close", (code, signal) => {
      clearTimeout(uhr);
      if (code === 0 && !abgebrochen) ok(Buffer.concat(aus).toString("utf8"));
      else
        fehler(
          new Error(
            signal || abgebrochen
              ? `${programm}: abgebrochen (${signal ?? "SIGKILL"})`
              : `${programm}: ${fehlertext.trim() || code}`,
          ),
        );
    });
    p.stdin.on("error", () => {});
    p.stdin.end(eingabe ? Buffer.from(eingabe) : undefined);
  });
}

/** Text aus einem Bild (JPEG, PNG, WebP, TIFF) */
export const bildText = (bytes: Uint8Array) => ausfuehren("tesseract", ["stdin", "stdout", "-l", ocrSprachen()], bytes);

/**
 * Prüft ein PDF mit pdfinfo, bevor pdftoppm es rastert: Jede der ersten MAX_SEITEN Seiten hat mit DPI höchstens
 * MAX_BILDPUNKTE (pdfinfo nennt den Beschnitt, deshalb rastert pdftoppm mit -cropbox). Mit mehrAblehnen ist ein PDF mit
 * mehr Seiten ein Fehler, sonst zählen nur die ersten. Ergebnis: die Zahl der Seiten, die gerastert werden.
 */
export async function seitenPruefen(
  datei: string,
  { zeitlimit = ZEITLIMIT, mehrAblehnen = false }: { zeitlimit?: number; mehrAblehnen?: boolean } = {},
): Promise<number> {
  const info = await ausfuehren("pdfinfo", ["-f", "1", "-l", String(MAX_SEITEN), datei], undefined, zeitlimit);
  const seiten = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  if (!Number.isInteger(seiten) || seiten < 1) throw new Error("Keine Seiten");
  if (mehrAblehnen && seiten > MAX_SEITEN) throw new Error(`Zu viele Seiten (${seiten}, höchstens ${MAX_SEITEN})`);
  for (const [, nr, b, h] of info.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)) {
    const punkte = ((Number(b) * DPI) / 72) * ((Number(h) * DPI) / 72);
    if (!(punkte <= MAX_BILDPUNKTE)) throw new Error(`Seite ${nr} zu groß (${b} × ${h} pt)`);
  }
  return Math.min(seiten, MAX_SEITEN);
}

/** Text aus einem gescannten PDF: jede Seite als Bild mit 300 dpi, dann Tesseract */
export async function pdfScanText(bytes: Uint8Array): Promise<string> {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-ocr-"));
  try {
    await writeFile(join(ordner, "scan.pdf"), bytes);
    await seitenPruefen(join(ordner, "scan.pdf"));
    await ausfuehren("pdftoppm", [
      "-r",
      String(DPI),
      "-cropbox",
      "-gray",
      "-png",
      "-l",
      String(MAX_SEITEN),
      join(ordner, "scan.pdf"),
      join(ordner, "seite"),
    ]);
    const seiten = (await readdir(ordner)).filter((n) => n.startsWith("seite")).sort();
    const texte: string[] = [];
    for (const s of seiten) texte.push(await bildText(await readFile(join(ordner, s))));
    return texte.join("\f");
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}
