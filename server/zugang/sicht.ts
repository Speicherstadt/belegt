import { type SQL, sql } from "drizzle-orm";
import type { Sichtbereich } from "../../shared/rollen.ts";
import type { Angemeldet } from "../auth.ts";
import type { Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import type { Zeitraum } from "./einladungen.ts";

/*
 * Die eine Stelle, die entscheidet, welche Dokumente ein Zugang sieht (docs/zugaenge.md). Der Prüfer sieht die
 * Dokumente seines Zeitraums, der Mitarbeiter die seines Sichtbereichs, alle anderen alles. Liste, Suche, Zahlen,
 * ähnliche Dokumente, Ableitungen, Mail und die Middleware für /api/dokumente/:id/... (server/http/zugang.ts) fragen
 * alle hier: sichtBedingung als SQL, sichtbareIds als Menge.
 */

export type Sicht =
  | { zeitraum: Zeitraum; bereich?: undefined }
  | { zeitraum?: undefined; bereich: Sichtbereich; nutzerId: string };

/** Die Sicht eines Zugangs; undefined heißt: sieht alles */
export function sichtVon(n: Pick<Angemeldet, "id" | "zeitraum" | "sichtbereich">): Sicht | undefined {
  if (n.zeitraum) return { zeitraum: n.zeitraum };
  if (n.sichtbereich) return { bereich: n.sichtbereich, nutzerId: n.id };
  return undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ein Array von UUIDs als Parameter; ungültige fallen weg, die Eingabe prüft Zod schon */
const uuids = (ids: string[]) => {
  const gueltig = ids.filter((id) => UUID.test(id));
  return gueltig.length
    ? sql`array[${sql.join(
        gueltig.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`
    : sql`'{}'::uuid[]`;
};

/**
 * Bedingung, die für die Dokument-ID in spalte wahr ist, wenn der Zugang das Dokument sieht. spalte ist immer ein
 * fester Ausdruck aus dem Code (etwa "d.id"), nie eine Eingabe. Beim Mitarbeiter:
 * - kein Tag aus ohneTags, und
 * - passend: je Art mit Einträgen mindestens einer davon (Tags, Dokumenttyp, Korrespondent), oder
 * - ohneOrdnung und das Dokument hat weder Tag noch Typ noch Korrespondenten, oder
 * - er hat es selbst hochgeladen und es hat noch keine Ordnung (sonst verschwände es nach dem Hochladen).
 */
export function sichtBedingung(spalte: string, sicht?: Sicht): SQL {
  if (!sicht) return sql`true`;
  const d = sql.raw(spalte);
  if (sicht.zeitraum)
    return sql`(belegt_dokument_tag(${d}) between ${sicht.zeitraum.von}::date and ${sicht.zeitraum.bis}::date)`;
  const b = sicht.bereich;
  const tag = (ids: string[]) =>
    sql`exists (select 1 from dokument_tags sb_t where sb_t.dokument_id = ${d} and sb_t.tag_id = any(${uuids(ids)}))`;
  const typ = sql`exists (select 1 from dokument_dokumenttypen sb_d where sb_d.dokument_id = ${d}
                           and sb_d.dokumenttyp_id = any(${uuids(b.dokumenttypen)}))`;
  const korrespondent = sql`exists (select 1 from dokument_korrespondenten sb_k where sb_k.dokument_id = ${d}
                                     and sb_k.korrespondent_id = any(${uuids(b.korrespondenten)}))`;
  const passend = [
    ...(b.tags.length ? [tag(b.tags)] : []),
    ...(b.dokumenttypen.length ? [typ] : []),
    ...(b.korrespondenten.length ? [korrespondent] : []),
  ];
  const ohneOrdnung = sql`(not exists (select 1 from dokument_tags sb_ot where sb_ot.dokument_id = ${d})
       and not exists (select 1 from dokument_dokumenttypen sb_od where sb_od.dokument_id = ${d})
       and not exists (select 1 from dokument_korrespondenten sb_ok where sb_ok.dokument_id = ${d}))`;
  const selbst = sql`exists (select 1 from einlieferungen sb_e where sb_e.dokument_id = ${d}
                              and sb_e.nutzer_id = ${sicht.nutzerId})`;
  return sql`(${b.ohneTags.length ? sql`not ${tag(b.ohneTags)}` : sql`true`}
    and ((${passend.length ? sql.join(passend, sql` and `) : sql`true`})
         or (${b.ohneOrdnung} and ${ohneOrdnung})
         or (${selbst} and ${ohneOrdnung})))`;
}

/** Welche der Dokumente der Zugang sieht; ohne Sicht alle, die es gibt */
export async function sichtbareIds(db: Datenbank | Tx, ids: string[], sicht?: Sicht): Promise<Set<string>> {
  const gueltig = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (!gueltig.length) return new Set();
  const zeilen = await db.execute<{ id: string }>(sql`
    select d.id from dokumente d where d.id = any(${uuids(gueltig)}) and ${sichtBedingung("d.id", sicht)}`);
  return new Set([...zeilen].map((z) => z.id));
}

/** Meldung, wenn ein Mitarbeiter ein Dokument aus seinem eigenen Sichtbereich schieben würde */
export const AUS_DEM_SICHTBEREICH =
  "Danach läge das Dokument außerhalb deines Sichtbereichs; diese Änderung kann nur der Inhaber vornehmen.";

/** Meldung, wenn ein Mitarbeiter beim Einordnen einen Korrespondenten nennt, den es in der Liste nicht gibt */
export const NEUER_KORRESPONDENT = "Diesen Korrespondenten gibt es nicht; neue legt nur der Inhaber an.";

/** Fehler, den die Routen als 409 melden: Die Änderung darf nur der Inhaber vornehmen */
export const nurFuerInhaber = (meldung: string) => Object.assign(new Error(meldung), { sichtbereich: true });

/**
 * Am Ende einer Änderung in derselben Transaktion: Sieht der Mitarbeiter das Dokument danach nicht mehr, wirft sie, und
 * die Transaktion rollt zurück. Ohne Sichtbereich (Inhaber, Programme) nichts.
 */
export async function imSichtbereichBleiben(tx: Tx, id: string, sicht?: Sicht): Promise<void> {
  if (!sicht?.bereich) return;
  if (!(await sichtbareIds(tx, [id], sicht)).has(id)) throw nurFuerInhaber(AUS_DEM_SICHTBEREICH);
}

export const istSichtbereichsFehler = (err: unknown): err is Error =>
  err instanceof Error && "sichtbereich" in err && err.sichtbereich === true;
