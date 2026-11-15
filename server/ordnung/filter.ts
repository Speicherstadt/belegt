import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Feld } from "./ordnung.ts";
import { Betrag, Datum } from "./ordnung.ts";

/*
 * Filter der Archivliste nach Tags, Dokumenttyp und eigenen Feldern. In der Abfrage von dokumente.ts ist d die Zeile
 * aus dokumente. Mehrere Tags: das Dokument hat alle (tagModus „alle“) oder mindestens einen („einer“); mehrere
 * Bedingungen: alle gelten.
 */

export interface FeldFilter {
  feldId: string;
  gesetzt?: boolean;
  enthaelt?: string;
  von?: number | string;
  bis?: number | string;
}

export interface OrdnungFilter {
  tags?: string[];
  /** „alle“ (Vorgabe): das Dokument hat jeden der Tags; „einer“: mindestens einen */
  tagModus?: "alle" | "einer";
  /** ID eines Dokumenttyps oder „ohne“ für Dokumente ohne Typ */
  dokumenttyp?: string;
  felder?: FeldFilter[];
}

const Id = z.uuid();

/**
 * Liest den Filter aus den Parametern einer Anfrage: tag (mehrfach), tagModus (alle oder einer), dokumenttyp, feld.<id>=gesetzt,
 * feld.<id>.enthaelt, feld.<id>.von und feld.<id>.bis (Betrag in Cent oder „1.234,56“, Datum JJJJ-MM-TT, Zahl).
 * Unbekannte Felder und unpassende Werte sind ein Fehler (null), kein stilles Ignorieren.
 */
export function filterAus(parameter: Record<string, string[]>, felder: Feld[]): OrdnungFilter | null {
  const tags = parameter.tag ?? [];
  if (!tags.every((t) => Id.safeParse(t).success)) return null;
  const tagModus = parameter.tagModus?.[0] ?? "alle";
  if (tagModus !== "alle" && tagModus !== "einer") return null;
  const typ = parameter.dokumenttyp?.[0];
  if (typ !== undefined && typ !== "ohne" && !Id.safeParse(typ).success) return null;
  const jeFeld = new Map<string, FeldFilter>();
  const jeId = new Map(felder.map((f) => [f.id, f]));
  for (const [schluessel, werte] of Object.entries(parameter)) {
    const treffer = /^feld\.([0-9a-f-]{36})(?:\.(enthaelt|von|bis))?$/i.exec(schluessel);
    if (!treffer) continue;
    const feld = jeId.get(treffer[1]!.toLowerCase());
    const wert = werte[0] ?? "";
    if (!feld) return null;
    const f = jeFeld.get(feld.id) ?? { feldId: feld.id };
    jeFeld.set(feld.id, f);
    const art = treffer[2];
    if (!art) {
      if (wert !== "gesetzt") return null;
      f.gesetzt = true;
    } else if (art === "enthaelt") {
      if (!["text", "link", "auswahl"].includes(feld.typ) || !wert.trim()) return null;
      f.enthaelt = wert.trim().slice(0, 200);
    } else {
      const grenze = grenzeAus(feld, wert);
      if (grenze === null) return null;
      f[art as "von" | "bis"] = grenze;
    }
  }
  return {
    ...(tags.length ? { tags: [...new Set(tags)], tagModus } : {}),
    ...(typ ? { dokumenttyp: typ } : {}),
    ...(jeFeld.size ? { felder: [...jeFeld.values()] } : {}),
  };
}

function grenzeAus(feld: Feld, wert: string): number | string | null {
  if (feld.typ === "datum") return Datum.safeParse(wert).data ?? null;
  if (feld.typ === "betrag") return Betrag.safeParse(/^-?\d+$/.test(wert) ? Number(wert) : wert).data ?? null;
  if (feld.typ === "zahl") return /^-?\d{1,16}$/.test(wert) ? Number(wert) : null;
  return null;
}

const wort = (t: string) => `%${t.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;

/** SQL-Bedingung für den Filter; true ohne Filter */
export function filterBedingung(f: OrdnungFilter | undefined): SQL {
  const teile: SQL[] = [];
  const tagBedingungen = (f?.tags ?? []).map(
    (tag) => sql`exists (select 1 from dokument_tags dt where dt.dokument_id = d.id and dt.tag_id = ${tag}::uuid)`,
  );
  if (f?.tagModus === "einer" && tagBedingungen.length) teile.push(sql`(${sql.join(tagBedingungen, sql` or `)})`);
  else teile.push(...tagBedingungen);
  if (f?.dokumenttyp === "ohne")
    teile.push(sql`not exists (select 1 from dokument_dokumenttypen dd where dd.dokument_id = d.id)`);
  else if (f?.dokumenttyp)
    teile.push(
      sql`exists (select 1 from dokument_dokumenttypen dd where dd.dokument_id = d.id and dd.dokumenttyp_id = ${f.dokumenttyp}::uuid)`,
    );
  for (const ff of f?.felder ?? []) {
    const bedingungen: SQL[] = [sql`fw.dokument_id = d.id`, sql`fw.feld_id = ${ff.feldId}::uuid`];
    if (ff.enthaelt) bedingungen.push(sql`fw.wert_text ilike ${wort(ff.enthaelt)}`);
    for (const [grenze, op] of [
      [ff.von, sql`>=`],
      [ff.bis, sql`<=`],
    ] as const) {
      if (grenze === undefined) continue;
      bedingungen.push(
        typeof grenze === "string"
          ? sql`fw.wert_datum ${op} ${grenze}::date`
          : sql`fw.wert_zahl ${op} ${grenze}::bigint`,
      );
    }
    teile.push(sql`exists (select 1 from feldwerte fw where ${sql.join(bedingungen, sql` and `)})`);
  }
  return teile.length ? sql.join(teile, sql` and `) : sql`true`;
}
