import { sniff } from "@firsttris/gobd-kern/dateityp";
import { officeTyp } from "../inhalt/office.ts";

/**
 * Typ einer Datei an ihrem Inhalt: zuerst, was der GoBD-Kern kennt (PDF, Bilder, XML), dann Office-Dateien, dann
 * reiner Text (gültiges UTF-8 ohne Steuerzeichen). Die Endung zählt nicht, sie lässt sich frei wählen.
 */
export function dateityp(bytes: Uint8Array, vorgabe = "application/octet-stream"): string {
  const kern = sniff(bytes)?.mimeType;
  if (kern) return kern;
  const office = officeTyp(bytes);
  if (office) return office;
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
