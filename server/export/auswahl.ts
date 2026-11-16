import { makeZip } from "client-zip";
import { sql } from "drizzle-orm";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { type Sicht, sichtBedingung } from "../zugang/sicht.ts";

/*
 * Mehrere Dokumente als ZIP (docs/dokument.md): die Originale unverändert, unter lesbaren Namen. Nur was der Zugang
 * sieht (server/zugang/sicht.ts); Unsichtbares fehlt ohne Hinweis, als gäbe es es nicht. Das ZIP entsteht als Stream:
 * Jedes Original wird erst gelesen, wenn das ZIP bei ihm ankommt, sodass höchstens eine Datei im Speicher liegt.
 */

/** So viele Dokumente höchstens, so viele wie eine Seite der Liste */
export const ZIP_MAX_DOKUMENTE = 200;
/** So viele Bytes höchstens, Summe der Originale; danach lieber den Z3-Export oder mehrere ZIPs */
export const ZIP_MAX_BYTES = 2 * 1024 ** 3;

/** Endung je Typ, wenn der Dateiname keine hat */
const ENDUNG: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/tiff": ".tif",
  "application/xml": ".xml",
  "text/xml": ".xml",
  "message/rfc822": ".eml",
  "text/plain": ".txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/rtf": ".rtf",
};

/**
 * Ein Teil eines Namens ohne Zeichen, die in Windows, macOS oder Linux nicht erlaubt sind oder aus dem Ordner führen
 * (/ \ : * ? " < > | und Steuerzeichen), ohne Punkte und Leerzeichen am Rand und höchstens 100 Zeichen lang
 */
export function namensteil(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: gerade die Steuerzeichen sollen weg
      .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .slice(0, 100)
      .replace(/^[\s.]+|[\s.]+$/g, "")
  );
}

export interface Benennbar {
  asn: number;
  /** Tag des Dokuments (Entstehung, sonst Eingang), JJJJ-MM-TT */
  tag: string;
  titel: string | null;
  dateiname: string | null;
  mimeType: string;
}

/** „ASN0042-2026-03-14-Rechnung Telekom.pdf“: Archivnummer, Tag, Titel (sonst Dateiname), Endung des Originals */
export function nameImZip(d: Benennbar): string {
  const endung = /\.[a-z0-9]{1,8}$/i.exec(d.dateiname ?? "")?.[0]?.toLowerCase() ?? ENDUNG[d.mimeType] ?? "";
  const ohneEndung = (d.dateiname ?? "").replace(/\.[^.]*$/, "");
  const titel = namensteil(d.titel ?? "") || namensteil(ohneEndung);
  return [`ASN${String(d.asn).padStart(4, "0")}`, d.tag, ...(titel ? [titel] : [])].join("-") + endung;
}

/** Gleiche Namen (ohne Rücksicht auf Groß- und Kleinschreibung) bekommen „ (2)“, „ (3)“ … vor der Endung */
export function eindeutig(namen: string[]): string[] {
  const vergeben = new Set<string>();
  return namen.map((name) => {
    const [, stamm, endung] = /^(.*?)(\.[^.]*)?$/.exec(name) ?? [];
    let kandidat = name;
    for (let n = 2; vergeben.has(kandidat.toLowerCase()); n++) kandidat = `${stamm} (${n})${endung ?? ""}`;
    vergeben.add(kandidat.toLowerCase());
    return kandidat;
  });
}

type Zeile = {
  id: string;
  sha256: string;
  groesse: string;
  mime_type: string;
  dateiname: string | null;
  eingegangen_am: Date;
  asn: string;
  tag: string;
  titel: string | null;
  geloescht: boolean;
};

export type ZipErgebnis =
  | { ok: true; stream: ReadableStream<Uint8Array>; anzahl: number }
  | { ok: false; grund: "keine" | "zu_gross" };

/**
 * Das ZIP zu den IDs in ihrer Reihenfolge. Gelöschte und Originale, die fehlen oder nicht mehr zu ihrem Hash passen,
 * stehen statt der Datei in „nicht-enthalten.txt“, damit niemand ein unvollständiges ZIP für vollständig hält.
 */
export async function auswahlZip(
  umgebung: Umgebung,
  ids: string[],
  sicht?: Sicht,
  { maxBytes = ZIP_MAX_BYTES }: { maxBytes?: number } = {},
): Promise<ZipErgebnis> {
  const eindeutigeIds = [...new Set(ids)];
  if (!eindeutigeIds.length) return { ok: false, grund: "keine" };
  const zeilen = [
    ...(await umgebung.db.execute<Zeile>(sql`
      select d.id, d.sha256, d.groesse, d.mime_type, d.dateiname, d.eingegangen_am, a.nummer as asn,
             belegt_dokument_tag(d.id)::text as tag, e.titel,
             exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null) as geloescht
        from dokumente d
        join archivnummern a on a.dokument_id = d.id
        left join lateral (select titel from einordnungen x where x.dokument_id = d.id
                            order by x.erstellt_am desc, x.id desc limit 1) e on true
       where d.id = any(${sql`array[${sql.join(
         eindeutigeIds.map((id) => sql`${id}`),
         sql`, `,
       )}]::uuid[]`})
         and ${sichtBedingung("d.id", sicht)}`)),
  ];
  if (!zeilen.length) return { ok: false, grund: "keine" };
  const reihenfolge = new Map(eindeutigeIds.map((id, i) => [id, i]));
  zeilen.sort((a, b) => reihenfolge.get(a.id)! - reihenfolge.get(b.id)!);
  const vorhanden = zeilen.filter((z) => !z.geloescht);
  if (vorhanden.reduce((summe, z) => summe + Number(z.groesse), 0) > maxBytes) return { ok: false, grund: "zu_gross" };
  const namen = eindeutig(
    zeilen.map((z) =>
      nameImZip({ asn: Number(z.asn), tag: z.tag, titel: z.titel, dateiname: z.dateiname, mimeType: z.mime_type }),
    ),
  );

  async function* eintraege() {
    const fehlend: string[] = [];
    for (const [i, z] of zeilen.entries()) {
      const name = namen[i]!;
      if (z.geloescht) {
        fehlend.push(`${name}: gelöscht`);
        continue;
      }
      // laden prüft den Hash; was nicht passt, geht nicht als Original hinaus
      const bytes = await umgebung.speicher.laden(z.sha256).catch(() => null);
      if (!bytes) {
        fehlend.push(`${name}: Datei fehlt oder wurde verändert`);
        continue;
      }
      yield { name, input: new Uint8Array(bytes), lastModified: new Date(z.eingegangen_am) };
    }
    if (fehlend.length)
      yield { name: "nicht-enthalten.txt", input: `${fehlend.join("\n")}\n`, lastModified: new Date() };
  }
  return { ok: true, stream: makeZip(eintraege(), { buffersAreUTF8: true }), anzahl: vorhanden.length };
}
