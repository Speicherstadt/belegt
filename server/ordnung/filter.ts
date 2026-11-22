import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Feld } from "./ordnung.ts";
import { Betrag, Datum } from "./ordnung.ts";

/*
 * Filter der Archivliste nach Tags, Dokumenttyp, Korrespondent und eigenen Feldern. In der Abfrage von dokumente.ts ist d die Zeile
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
  /** ID eines Korrespondenten oder „ohne“ für Dokumente ohne */
  korrespondent?: string;
  felder?: FeldFilter[];
  /** Dokumente mit diesen Tags fallen weg */
  tagsNicht?: string[];
  /** Nur Dokumente ohne jeden Tag */
  ohneTags?: boolean;
  /** Tag der Entstehung (wie die Sortierung „entstanden“) und Tag des Eingangs in Berlin, je JJJJ-MM-TT, Grenzen eingeschlossen */
  entstandenVon?: string;
  entstandenBis?: string;
  eingegangenVon?: string;
  eingegangenBis?: string;
}

const DATUMSGRENZEN = ["entstandenVon", "entstandenBis", "eingegangenVon", "eingegangenBis"] as const;

const Id = z.uuid();

/**
 * Liest den Filter aus den Parametern einer Anfrage: tag (mehrfach), tagModus (alle oder einer), dokumenttyp,
 * korrespondent (ID oder „ohne“), feld.<id>=gesetzt,
 * feld.<id>.enthaelt, feld.<id>.von und feld.<id>.bis (Betrag in Cent oder „1.234,56“, Datum JJJJ-MM-TT, Zahl).
 * tagNicht (mehrfach, schließt aus), ohneTags=1 (nur ohne Tag),
 * entstandenVon, entstandenBis, eingegangenVon und eingegangenBis (JJJJ-MM-TT; von nach bis ist ein Fehler).
 * Unbekannte Felder und unpassende Werte sind ein Fehler (null), kein stilles Ignorieren.
 */
export function filterAus(parameter: Record<string, string[]>, felder: Feld[]): OrdnungFilter | null {
  const tags = parameter.tag ?? [];
  if (!tags.every((t) => Id.safeParse(t).success)) return null;
  const tagsNicht = parameter.tagNicht ?? [];
  if (!tagsNicht.every((t) => Id.safeParse(t).success)) return null;
  const ohneTags = parameter.ohneTags?.[0];
  if (ohneTags !== undefined && ohneTags !== "1") return null;
  const tagModus = parameter.tagModus?.[0] ?? "alle";
  if (tagModus !== "alle" && tagModus !== "einer") return null;
  const typ = parameter.dokumenttyp?.[0];
  if (typ !== undefined && typ !== "ohne" && !Id.safeParse(typ).success) return null;
  const korrespondent = parameter.korrespondent?.[0];
  if (korrespondent !== undefined && korrespondent !== "ohne" && !Id.safeParse(korrespondent).success) return null;
  const daten: Partial<Record<(typeof DATUMSGRENZEN)[number], string>> = {};
  for (const name of DATUMSGRENZEN) {
    const wert = parameter[name]?.[0];
    if (wert === undefined || wert === "") continue;
    const datum = Datum.safeParse(wert);
    if (!datum.success) return null;
    daten[name] = datum.data;
  }
  if (daten.entstandenVon && daten.entstandenBis && daten.entstandenVon > daten.entstandenBis) return null;
  if (daten.eingegangenVon && daten.eingegangenBis && daten.eingegangenVon > daten.eingegangenBis) return null;
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
    ...(tagsNicht.length ? { tagsNicht: [...new Set(tagsNicht)] } : {}),
    ...(ohneTags ? { ohneTags: true } : {}),
    ...(typ ? { dokumenttyp: typ } : {}),
    ...(korrespondent ? { korrespondent } : {}),
    ...(jeFeld.size ? { felder: [...jeFeld.values()] } : {}),
    ...daten,
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
  for (const tag of f?.tagsNicht ?? [])
    teile.push(
      sql`not exists (select 1 from dokument_tags dt where dt.dokument_id = d.id and dt.tag_id = ${tag}::uuid)`,
    );
  if (f?.ohneTags) teile.push(sql`not exists (select 1 from dokument_tags dt where dt.dokument_id = d.id)`);
  if (f?.dokumenttyp === "ohne")
    teile.push(sql`not exists (select 1 from dokument_dokumenttypen dd where dd.dokument_id = d.id)`);
  else if (f?.dokumenttyp)
    teile.push(
      sql`exists (select 1 from dokument_dokumenttypen dd where dd.dokument_id = d.id and dd.dokumenttyp_id = ${f.dokumenttyp}::uuid)`,
    );
  if (f?.korrespondent === "ohne")
    teile.push(sql`not exists (select 1 from dokument_korrespondenten dk where dk.dokument_id = d.id)`);
  else if (f?.korrespondent)
    teile.push(
      sql`exists (select 1 from dokument_korrespondenten dk where dk.dokument_id = d.id and dk.korrespondent_id = ${f.korrespondent}::uuid)`,
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
  if (f?.entstandenVon) teile.push(sql`belegt_dokument_tag(d.id) >= ${f.entstandenVon}::date`);
  if (f?.entstandenBis) teile.push(sql`belegt_dokument_tag(d.id) <= ${f.entstandenBis}::date`);
  const eingang = sql`(d.eingegangen_am at time zone 'Europe/Berlin')::date`;
  if (f?.eingegangenVon) teile.push(sql`${eingang} >= ${f.eingegangenVon}::date`);
  if (f?.eingegangenBis) teile.push(sql`${eingang} <= ${f.eingegangenBis}::date`);
  return teile.length ? sql.join(teile, sql` and `) : sql`true`;
}
