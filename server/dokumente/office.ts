import { unzipSync } from "fflate";

/**
 * Text aus Office-Dateien für die Volltextsuche: Word, Excel und PowerPoint (Office Open XML, ECMA-376) sowie
 * OpenDocument (Text, Tabelle, Präsentation). Beides sind ZIP-Archive mit XML; Belegt liest nur die Teile mit Text und
 * entpackt höchstens MAX_ENTPACKT, damit eine präparierte Datei (ZIP-Bombe) den Worker nicht füllt.
 */

const MAX_ENTPACKT = 50 * 1024 * 1024;
/** Die Zahl der Einträge steht im Verzeichnisende und lässt sich frei behaupten (ZIP64: bis 2^32 - 1) */
const MAX_EINTRAEGE = 10_000;

/** Bricht ab, sobald ein ZIP mehr Einträge hat, als ein Office-Dokument braucht */
function gezaehlt() {
  let n = 0;
  return () => {
    if (++n > MAX_EINTRAEGE) throw new Error("Office-Datei: zu viele Einträge");
  };
}

export const OFFICE_TYPEN = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
} as const;

const istZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Namen der Einträge eines ZIP, ohne zu entpacken (Verzeichnis am Ende) */
function eintraege(bytes: Uint8Array): string[] {
  const namen: string[] = [];
  const zaehlen = gezaehlt();
  try {
    unzipSync(bytes, {
      filter: (f) => {
        zaehlen();
        namen.push(f.name);
        return false;
      },
    });
  } catch {
    return [];
  }
  return namen;
}

/** Der Office-Typ am Inhalt, nicht an der Endung; sonst null */
export function officeTyp(bytes: Uint8Array): string | null {
  if (!istZip(bytes)) return null;
  // OpenDocument: der erste Eintrag heißt mimetype und enthält den Typ unkomprimiert (ODF 1.2, Teil 3, 3.3)
  const kopf = Buffer.from(bytes.subarray(30, 120)).toString("latin1");
  if (kopf.startsWith("mimetype")) {
    for (const typ of [OFFICE_TYPEN.odt, OFFICE_TYPEN.ods, OFFICE_TYPEN.odp]) if (kopf.includes(typ)) return typ;
  }
  const namen = eintraege(bytes);
  if (!namen.includes("[Content_Types].xml")) return null;
  if (namen.includes("word/document.xml")) return OFFICE_TYPEN.docx;
  if (namen.includes("xl/workbook.xml")) return OFFICE_TYPEN.xlsx;
  if (namen.includes("ppt/presentation.xml")) return OFFICE_TYPEN.pptx;
  return null;
}

const VORDEFINIERT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const entitaeten = (t: string) =>
  t.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (ganz, e: string) => {
    if (!e.startsWith("#")) return VORDEFINIERT[e] ?? ganz;
    const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ganz;
  });

/** Text aus einem XML-Teil: Absätze und Zeilen werden zu Zeilenumbrüchen, Tabulatoren bleiben, Tags fallen weg */
function xmlText(xml: string): string {
  return entitaeten(
    xml
      .replace(/<\/(w:p|a:p|text:p|text:h|row|table:table-row)>/g, "\n")
      .replace(/<(w:tab|w:br|text:tab|text:line-break)\b[^>]*\/>/g, (t) => (t.includes("tab") ? "\t" : "\n"))
      .replace(/<\/(c|table:table-cell)>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Welche Teile Text tragen, je Typ, in Lesereihenfolge */
function textTeile(typ: string): (name: string) => boolean {
  switch (typ) {
    case OFFICE_TYPEN.docx:
      return (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n);
    case OFFICE_TYPEN.xlsx:
      return (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
    case OFFICE_TYPEN.pptx:
      return (n) => /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(n);
    default:
      return (n) => n === "content.xml";
  }
}

const zahl = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);

/** Der Text einer Office-Datei; wirft bei zu großem oder kaputtem Inhalt */
export function officeText(bytes: Uint8Array, typ: string): string {
  const passt = textTeile(typ);
  let summe = 0;
  const zaehlen = gezaehlt();
  const teile = unzipSync(bytes, {
    filter: (f) => {
      zaehlen();
      if (!passt(f.name)) return false;
      summe += f.originalSize;
      if (summe > MAX_ENTPACKT) throw new Error("Office-Datei: entpackt zu groß");
      return true;
    },
  });
  const namen = Object.keys(teile).sort(
    (a, b) => a.replace(/\d+\.xml$/, "").localeCompare(b.replace(/\d+\.xml$/, "")) || zahl(a) - zahl(b),
  );
  let text = namen
    .map((n) => xmlText(new TextDecoder().decode(teile[n])))
    .filter(Boolean)
    .join("\n\n");
  if (typ === OFFICE_TYPEN.xlsx) {
    // In den Blättern stehen bei Texten nur Nummern in die Liste sharedStrings; die Zahlen dort bleiben als Werte
    text = text.replace(/^\s*$/gm, "");
  }
  return text;
}
