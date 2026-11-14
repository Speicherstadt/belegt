import { sniff } from "@firsttris/gobd-kern/dateityp";
import { officeTyp } from "../inhalt/office.ts";

/** Ältere Office-Formate: Word, Excel und PowerPoint bis 2003 (Compound File) und RTF */
export const ALTE_OFFICE_TYPEN = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  rtf: "application/rtf",
} as const;

/** Kopf einer Compound File (MS-CFB 2.2) */
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Name eines Streams im Verzeichnis der Compound File, UTF-16LE */
const strom = (name: string) => Buffer.from(name, "utf16le");

/** Welche Anwendung die Compound File schrieb, an ihrem Hauptstream ([MS-DOC], [MS-XLS], [MS-PPT]) */
function alterOfficeTyp(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "{\\rtf") return ALTE_OFFICE_TYPEN.rtf;
  if (bytes.length < 512 || CFB.some((b, i) => bytes[i] !== b)) return null;
  const hat = (name: string) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).includes(strom(name));
  if (hat("WordDocument")) return ALTE_OFFICE_TYPEN.doc;
  if (hat("Workbook") || hat("Book\u0000")) return ALTE_OFFICE_TYPEN.xls;
  if (hat("PowerPoint Document")) return ALTE_OFFICE_TYPEN.ppt;
  return null;
}

/**
 * Typ einer Datei an ihrem Inhalt: zuerst, was der GoBD-Kern kennt (PDF, Bilder, XML), dann Office-Dateien (neu und
 * alt), dann reiner Text (gültiges UTF-8 ohne Steuerzeichen). Die Endung zählt nicht, sie lässt sich frei wählen.
 */
export function dateityp(bytes: Uint8Array, vorgabe = "application/octet-stream"): string {
  const kern = sniff(bytes)?.mimeType;
  if (kern) return kern;
  const office = officeTyp(bytes);
  if (office) return office;
  const alt = alterOfficeTyp(bytes);
  if (alt) return alt;
  if (istText(bytes)) return "text/plain";
  return vorgabe;
}

function istText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const probe = bytes.subarray(0, 64 * 1024);
  try {
    // fatal: ungültiges UTF-8 wirft; am Ende der Probe darf ein Zeichen abgeschnitten sein
    new TextDecoder("utf-8", { fatal: true }).decode(
      probe.length < bytes.length ? probe.subarray(0, probe.length - 4) : probe,
    );
  } catch {
    return false;
  }
  // Steuerzeichen außer Tabulator, Zeilenumbruch, Wagenrücklauf und Seitenvorschub: dann ist es keine Textdatei
  for (const b of probe) if (b < 9 || (b > 13 && b < 32 && b !== 27)) return false;
  return true;
}
