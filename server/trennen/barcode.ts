import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prepareZXingModule as leserVorbereiten, readBarcodes } from "zxing-wasm/reader";
import { prepareZXingModule as schreiberVorbereiten, writeBarcode } from "zxing-wasm/writer";

/*
 * Barcodes mit ZXing-C++ als WebAssembly (zxing-wasm, MIT): reines WASM, kein Programm im Container. Von Haus aus lädt
 * zxing-wasm die WASM-Datei von einem CDN; hier kommt sie aus node_modules, Belegt braucht dafür kein Internet.
 */

const require = createRequire(import.meta.url);
const wasm = (pfad: string) => {
  const b = readFileSync(require.resolve(pfad));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

let leser = false;
let schreiber = false;

/** Texte aller QR- und Code-128-Codes in einem Bild (PNG, JPEG) */
export async function codesLesen(bild: Uint8Array): Promise<string[]> {
  if (!leser) leserVorbereiten({ overrides: { wasmBinary: wasm("zxing-wasm/reader/zxing_reader.wasm") } });
  leser = true;
  const treffer = await readBarcodes(bild, { formats: ["QRCode", "Code128"], tryHarder: true });
  return treffer.filter((t) => t.isValid).map((t) => t.text);
}

/** Module eines Codes: Breite, Höhe und je Modul 0 (schwarz) oder 255 (weiß), ohne Ruhezone */
export interface CodeBild {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export async function codeSchreiben(text: string, format: "QRCode" | "Code128"): Promise<CodeBild> {
  if (!schreiber) schreiberVorbereiten({ overrides: { wasmBinary: wasm("zxing-wasm/writer/zxing_writer.wasm") } });
  schreiber = true;
  const r = await writeBarcode(text, { format, addQuietZones: false, options: format === "QRCode" ? "ecLevel=M" : "" });
  if (r.error) throw new Error(`Barcode: ${r.error}`);
  return r.symbol;
}
