import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { dateityp } from "../dokumente/dateityp.ts";
import { ausfuehren } from "../inhalt/ocr.ts";
import type { Teil } from "../ordner/ordner.ts";
import { codesLesen } from "./barcode.ts";

/*
 * Gescannte Stapel an Trennblättern teilen: jede Seite mit pdftoppm als Bild, Barcodes darin mit zxing-wasm, dann
 * die Seiten zwischen zwei Trennblättern mit pdf-lib als eigenes PDF. Der Stapel ist nur das Transportmittel; jedes
 * Teil wird als eigenes Original aufgenommen, die Trennblätter fallen weg.
 */

/** Auflösung zum Suchen der Codes; ein gedrucktes Trennblatt liest sich damit sicher, und es geht schnell */
const DPI = "150";

let verfuegbar: boolean | undefined;
/** Ob pdftoppm installiert ist; ohne wird nicht geteilt */
export const trennenVerfuegbar = () => (verfuegbar ??= spawnSync("pdftoppm", ["-v"], { stdio: "ignore" }).status === 0);

/**
 * Seiten (ab 0) zwischen den Trennblättern, ohne die Trennblätter und ohne leere Teile. Ohne Trennblatt oder wenn
 * nur Trennblätter da sind: null, das PDF bleibt, wie es ist.
 */
export function teilbereiche(seiten: number, trenner: Iterable<number>): number[][] | null {
  const t = new Set(trenner);
  if (t.size === 0) return null;
  const teile: number[][] = [[]];
  for (let s = 0; s < seiten; s++) {
    if (t.has(s)) teile.push([]);
    else teile.at(-1)!.push(s);
  }
  const voll = teile.filter((teil) => teil.length > 0);
  return voll.length ? voll : null;
}

/** Seiten (ab 0), auf denen ein Code mit genau diesem Text steht */
export async function trennerSuchen(pdf: Uint8Array, code: string, zeitlimit: number): Promise<number[]> {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-trennen-"));
  try {
    await writeFile(join(ordner, "stapel.pdf"), pdf);
    await ausfuehren(
      "pdftoppm",
      ["-r", DPI, "-gray", "-png", join(ordner, "stapel.pdf"), join(ordner, "seite")],
      undefined,
      zeitlimit,
    );
    const trenner: number[] = [];
    for (const name of await readdir(ordner)) {
      const nummer = name.match(/^seite-(\d+)\.png$/)?.[1];
      if (!nummer) continue;
      const codes = await codesLesen(await readFile(join(ordner, name)));
      if (codes.some((c) => c.trim() === code)) trenner.push(Number(nummer) - 1);
    }
    return trenner.sort((a, b) => a - b);
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

/** Ein neues PDF je Teil; ohne neue Metadaten, damit dasselbe Teil immer dieselben Bytes (und denselben Hash) hat */
export async function pdfTeilen(pdf: Uint8Array, teile: number[][]): Promise<Uint8Array[]> {
  const quelle = await PDFDocument.load(pdf, { updateMetadata: false });
  const ergebnis: Uint8Array[] = [];
  for (const seiten of teile) {
    const ziel = await PDFDocument.create({ updateMetadata: false });
    for (const seite of await ziel.copyPages(quelle, seiten)) ziel.addPage(seite);
    ergebnis.push(await ziel.save());
  }
  return ergebnis;
}

/** Teilt einen Stapel; null, wenn er kein Trennblatt hat */
export async function stapelTeilen(
  pdf: Uint8Array,
  code: string,
  zeitlimit = 5 * 60_000,
): Promise<Uint8Array[] | null> {
  const seiten = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
  const teile = teilbereiche(seiten, await trennerSuchen(pdf, code, zeitlimit));
  return teile ? pdfTeilen(pdf, teile) : null;
}

const KIND = fileURLToPath(new URL("./trennen-kind.ts", import.meta.url));

/**
 * stapelTeilen in einem eigenen Bun-Prozess mit Zeitlimit, wie lesenImKind: pdf-lib und das Rendern hängen sonst an
 * einem kaputten PDF fest. Das Kind schreibt die Teile in einen eigenen Ordner.
 */
export async function teilenImKind(
  pdf: Uint8Array,
  code: string,
  zeitlimit = 10 * 60_000,
): Promise<Uint8Array[] | null> {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-teile-"));
  try {
    const { teile } = JSON.parse(await ausfuehren("bun", [KIND, code, ordner], pdf, zeitlimit)) as { teile: number };
    if (!teile) return null;
    const ergebnis: Uint8Array[] = [];
    for (let i = 1; i <= teile; i++) ergebnis.push(new Uint8Array(await readFile(join(ordner, `teil-${i}.pdf`))));
    return ergebnis;
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

/** „scan.pdf“ wird „scan-1.pdf“, „scan-2.pdf“ … */
export function teilName(dateiname: string, nummer: number): string {
  const stamm = dateiname.replace(/\.pdf$/i, "") || "scan";
  return `${stamm}-${nummer}.pdf`;
}

/**
 * Teilt eine Datei, wenn sie ein PDF mit Trennblättern ist und pdftoppm da ist; sonst null (unverändert aufnehmen).
 * Wirft, wenn das Teilen scheitert; der Aufrufer nimmt die Datei dann unverändert auf.
 */
export async function dateiTeilen(
  bytes: Uint8Array,
  dateiname: string,
  { code, zeitlimit }: { code: string; zeitlimit?: number },
): Promise<Teil[] | null> {
  if (dateityp(bytes) !== "application/pdf" || !trennenVerfuegbar()) return null;
  const teile = await teilenImKind(bytes, code, zeitlimit);
  return teile?.map((t, i) => ({ bytes: t, dateiname: teilName(dateiname, i + 1) })) ?? null;
}
