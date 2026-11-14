import type { BeschriebeneTabelle } from "@firsttris/gobd-kern/beschreibung";
import { sql } from "drizzle-orm";
import { betragAlsText } from "../../shared/ordnung.ts";
import type { Datenbank } from "../db/client.ts";

/*
 * Tags und eigene Felder im Datenträger: je eine CSV in langer Form (eine Zeile je Dokument und Tag oder Feld), damit
 * eine Prüfsoftware sie ohne Zerlegen liest. Beträge in Euro mit Komma und zwei Nachkommastellen (DecimalSymbol der
 * index.xml), Zahlen ganzzahlig, Datum als JJJJ-MM-TT; der Typ jeder Spalte steht in der index.xml.
 */

export const TAGS: BeschriebeneTabelle = {
  path: "tags.csv",
  name: "Tags",
  beschreibung: "Tags der Dokumente, eine Zeile je Dokument und Tag; änderbare Metadaten, jede Änderung im Protokoll",
  spalten: [
    { name: "Dokument-ID", typ: { art: "text" } },
    { name: "ASN", typ: { art: "zahl", nachkommastellen: 0 } },
    { name: "Tag", typ: { art: "text" } },
  ],
};

export const FELDER: BeschriebeneTabelle = {
  path: "felder.csv",
  name: "Eigene Felder",
  beschreibung:
    "Werte eigener Felder, eine Zeile je Dokument und Feld; je nach Feldtyp ist Text, Zahl, Betrag (EUR), Datum oder Ja/Nein gefüllt",
  spalten: [
    { name: "Dokument-ID", typ: { art: "text" } },
    { name: "ASN", typ: { art: "zahl", nachkommastellen: 0 } },
    { name: "Feld", typ: { art: "text" } },
    { name: "Feldtyp", typ: { art: "text" } },
    { name: "Text", typ: { art: "text" } },
    { name: "Zahl", typ: { art: "zahl", nachkommastellen: 0 } },
    { name: "Betrag EUR", typ: { art: "zahl", nachkommastellen: 2 } },
    { name: "Datum", typ: { art: "datum" } },
    { name: "Ja/Nein", typ: { art: "text" } },
  ],
};

const idListe = (ids: string[]) =>
  sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;

/** Zeilen für tags.csv */
export async function tagZeilen(db: Datenbank, ids: string[]): Promise<(string | number)[][]> {
  if (!ids.length) return [];
  const zeilen = await db.execute<{ dokument_id: string; asn: string; name: string }>(sql`
    select dt.dokument_id, a.nummer as asn, t.name from dokument_tags dt
      join tags t on t.id = dt.tag_id join archivnummern a on a.dokument_id = dt.dokument_id
     where dt.dokument_id = any(${idListe(ids)}) order by a.nummer, lower(t.name)`);
  return [...zeilen].map((z) => [z.dokument_id, Number(z.asn), z.name]);
}

/** Zeilen für felder.csv */
export async function feldZeilen(db: Datenbank, ids: string[]): Promise<(string | number | null)[][]> {
  if (!ids.length) return [];
  const zeilen = await db.execute<{
    dokument_id: string;
    asn: string;
    name: string;
    typ: string;
    wert_text: string | null;
    wert_zahl: string | null;
    wert_datum: string | null;
    wert_bool: boolean | null;
  }>(sql`
    select fw.dokument_id, a.nummer as asn, f.name, f.typ, fw.wert_text, fw.wert_zahl, fw.wert_datum::text as wert_datum,
           fw.wert_bool
      from feldwerte fw join felder f on f.id = fw.feld_id join archivnummern a on a.dokument_id = fw.dokument_id
     where fw.dokument_id = any(${idListe(ids)}) order by a.nummer, lower(f.name)`);
  return [...zeilen].map((z) => [
    z.dokument_id,
    Number(z.asn),
    z.name,
    z.typ,
    z.wert_text,
    z.typ === "zahl" && z.wert_zahl !== null ? Number(z.wert_zahl) : null,
    z.typ === "betrag" && z.wert_zahl !== null ? betragAlsText(Number(z.wert_zahl)) : null,
    z.wert_datum,
    z.wert_bool === null ? null : z.wert_bool ? "ja" : "nein",
  ]);
}

/** Tabellen der Ordnung, deren Einträge im Protokoll über dokument_id zu einem Dokument gehören */
export const ORDNUNG_IM_PROTOKOLL = ["dokument_tags", "dokument_dokumenttypen", "feldwerte"] as const;
