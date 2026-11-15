import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { regexGueltig, unscharfKurzGenug } from "../../shared/abgleich.ts";
import { mitAkteur, type Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumentKorrespondenten, korrespondenten, regeln, workflows } from "../db/schema.ts";
import type { Sicht } from "../zugang/sicht.ts";
import type { Korrespondent } from "./korrespondent-setzen.ts";
import {
  Abgleich,
  aendertAbgleich,
  eindeutig,
  imSichtbereich,
  inSicht,
  konflikt,
  UNSCHARF_ZU_LANG,
} from "./ordnung.ts";

export { korrespondentMitNamen, korrespondentSetzen } from "./korrespondent-setzen.ts";

/*
 * Korrespondenten als Liste (docs/ordnung.md#korrespondenten): anlegen, umbenennen, zusammenführen, löschen. Die
 * Einordnung ist versiegelt und behält den Text, der beim Einordnen galt; umbenennen und zusammenführen ändern nur die
 * Liste und die Zuordnung in dokument_korrespondenten, jede Zeile im Audit-Log.
 */

const Name = z.string().trim().min(1).max(300);

const regexPasst = (a: z.infer<typeof Abgleich>) =>
  a.abgleich !== "regex" || (a.abgleichText !== undefined && regexGueltig(a.abgleichText.trim()));
const REGEX_UNGUELTIG = { message: "Kein gültiger regulärer Ausdruck", path: ["abgleichText"] };

export const KorrespondentEingabe = z
  .object({ name: Name, ...Abgleich.shape })
  .refine(regexPasst, REGEX_UNGUELTIG)
  .refine(unscharfKurzGenug, UNSCHARF_ZU_LANG);
export const KorrespondentAenderung = z
  .object({ name: Name.optional(), ...Abgleich.shape })
  .refine((k) => k.name !== undefined || aendertAbgleich(k), { message: "Name oder Zuordnung" })
  .refine(regexPasst, REGEX_UNGUELTIG)
  .refine(unscharfKurzGenug, UNSCHARF_ZU_LANG);
export const Zusammenfuehrung = z.object({ ziel: z.uuid() });

export type { Korrespondent };

/**
 * Korrespondenten mit der Zahl ihrer Dokumente (ohne gelöschte); mit Zeitraum (Prüfer) nur die mit Dokumenten darin,
 * gezählt nur diese; mit Sichtbereich (Mitarbeiter) die seines Sichtbereichs (imSichtbereich)
 */
export async function korrespondentenListen(
  db: Datenbank,
  sicht?: Sicht,
): Promise<(Korrespondent & { anzahl: number })[]> {
  const zeilen = await db
    .select({
      k: korrespondenten,
      anzahl: sql<string>`(select count(*) from dokument_korrespondenten dk
                            where dk.korrespondent_id = "korrespondenten"."id"
                              and not exists (select 1 from loeschungen l
                                               where l.dokument_id = dk.dokument_id and l.bestaetigt_am is not null)
                              ${inSicht("dk.dokument_id", sicht)})`,
    })
    .from(korrespondenten)
    .orderBy(asc(sql`lower(${korrespondenten.name})`));
  const alle = zeilen.map((z) => ({ ...z.k, anzahl: Number(z.anzahl) }));
  // Namen von Geschäftspartnern außerhalb seines Zeitraums sieht der Prüfer nicht
  return sicht?.zeitraum ? alle.filter((k) => k.anzahl > 0) : imSichtbereich(alle, sicht, "korrespondenten");
}

const sauber = <T extends { abgleichText?: string }>(e: T): T =>
  e.abgleichText === undefined ? e : { ...e, abgleichText: e.abgleichText.trim() };

export async function korrespondentAnlegen(
  db: Datenbank,
  eingabe: z.infer<typeof KorrespondentEingabe>,
  akteur: string,
): Promise<Korrespondent> {
  const [neu] = await eindeutig(
    mitAkteur(db, akteur, (tx) => tx.insert(korrespondenten).values(sauber(eingabe)).returning()),
  );
  return neu!;
}

/** Umbenennen oder die Zuordnungsregel ändern; die versiegelten Einordnungen behalten ihren Text */
export async function korrespondentAendern(
  db: Datenbank,
  id: string,
  eingabe: z.infer<typeof KorrespondentAenderung>,
  akteur: string,
): Promise<Korrespondent | null> {
  const [k] = await eindeutig(
    mitAkteur(db, akteur, (tx) =>
      tx.update(korrespondenten).set(sauber(eingabe)).where(eq(korrespondenten.id, id)).returning(),
    ),
  );
  return k ?? null;
}

const geloescht = sql`exists (select 1 from loeschungen l where l.dokument_id = ${dokumentKorrespondenten.dokumentId}
                               and l.bestaetigt_am is not null)`;

/**
 * Entfernt die Zuordnungen gelöschter Dokumente zu einem Korrespondenten (jede im Audit-Log, wie beim Löschen eines
 * Tags): Postgres lässt sie nicht mehr ändern, und ohne das ließe sich der Eintrag nie entfernen. Ihr Text bleibt in der
 * versiegelten Einordnung und im Audit-Log.
 */
const geloeschteLoesen = (tx: Tx, id: string) =>
  tx.delete(dokumentKorrespondenten).where(sql`${dokumentKorrespondenten.korrespondentId} = ${id} and ${geloescht}`);

/** Löscht einen Korrespondenten, den kein Dokument im Archiv nutzt; sonst ein Konflikt (zusammenführen) */
export function korrespondentLoeschen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  return mitAkteur(db, akteur, async (tx) => {
    const [genutzt] = await tx.execute<{ n: string }>(sql`
      select count(*) as n from dokument_korrespondenten
       where korrespondent_id = ${id} and not ${geloescht}`);
    if (Number(genutzt?.n ?? 0) > 0)
      throw konflikt(`Noch ${genutzt!.n} Dokumente haben diesen Korrespondenten; zusammenführen statt löschen`);
    await geloeschteLoesen(tx, id);
    await regelnUmhaengen(tx, id, null);
    return (
      (await tx.delete(korrespondenten).where(eq(korrespondenten.id, id)).returning({ id: korrespondenten.id }))
        .length > 0
    );
  });
}

/**
 * Führt zwei Schreibweisen zusammen: Die Dokumente von id bekommen ziel, Regeln und Workflows, die id vorschlagen oder
 * setzen, nennen danach ziel, und id verschwindet aus der Liste. Alles in einer Transaktion, jede Zeile im Audit-Log.
 */
export function zusammenfuehren(
  db: Datenbank,
  id: string,
  ziel: string,
  akteur: string,
): Promise<Korrespondent | null> {
  if (id === ziel) return Promise.reject(konflikt("Ein Korrespondent lässt sich nicht mit sich selbst zusammenführen"));
  return mitAkteur(db, akteur, async (tx) => {
    const da = await tx
      .select()
      .from(korrespondenten)
      .where(sql`${korrespondenten.id} in (${id}, ${ziel})`)
      .for("update");
    const zielZeile = da.find((k) => k.id === ziel);
    if (da.length !== 2 || !zielZeile) return null;
    await geloeschteLoesen(tx, id);
    await tx
      .update(dokumentKorrespondenten)
      .set({ korrespondentId: ziel, geaendertAm: sql`now()` })
      .where(eq(dokumentKorrespondenten.korrespondentId, id));
    await regelnUmhaengen(tx, id, ziel);
    await sichtbereicheUmhaengen(tx, id, ziel);
    await tx.delete(korrespondenten).where(eq(korrespondenten.id, id));
    return zielZeile;
  });
}

/**
 * Sichtbereiche von Mitarbeitern und offenen Einladungen, die den Korrespondenten erlauben, erlauben danach ziel
 * (server/zugang/sicht.ts). Beim Löschen bleibt die ID stehen: Eine leere Liste schränkte nicht mehr ein.
 */
async function sichtbereicheUmhaengen(tx: Tx, id: string, ziel: string) {
  const neu = sql`jsonb_set(sichtbereich, '{korrespondenten}', (
    select coalesce(jsonb_agg(distinct case when k = ${id} then ${ziel} else k end), '[]'::jsonb)
      from jsonb_array_elements_text(sichtbereich -> 'korrespondenten') k))`;
  const nennt = sql`jsonb_typeof(sichtbereich -> 'korrespondenten') = 'array'
    and sichtbereich -> 'korrespondenten' ? ${id}`;
  await tx.execute(sql`update "user" set sichtbereich = ${neu} where ${nennt}`);
  await tx.execute(sql`update einladungen set sichtbereich = ${neu} where eingeloest_am is null and ${nennt}`);
}

/** Regeln und Workflows, die den Korrespondenten nennen, auf ziel umstellen; ohne ziel fällt er dort weg */
async function regelnUmhaengen(tx: Tx, id: string, ziel: string | null) {
  const alle = await tx.select({ id: regeln.id, ordnung: regeln.ordnung }).from(regeln);
  for (const r of alle) {
    const o = r.ordnung as { korrespondent?: string | null } | null;
    if (o?.korrespondent === id)
      await tx
        .update(regeln)
        .set({ ordnung: { ...o, korrespondent: ziel } })
        .where(eq(regeln.id, r.id));
  }
  const flows = await tx
    .select({ id: workflows.id, bedingungen: workflows.bedingungen, aktionen: workflows.aktionen })
    .from(workflows);
  for (const w of flows) {
    const b = w.bedingungen as { korrespondent?: string };
    const aktionen = w.aktionen as { art: string; korrespondent?: string }[];
    const bNeu =
      b.korrespondent === id
        ? ziel
          ? { ...b, korrespondent: ziel }
          : Object.fromEntries(Object.entries(b).filter(([k]) => k !== "korrespondent"))
        : b;
    const aNeu = aktionen.map((a) =>
      a.art === "korrespondent" && a.korrespondent === id ? { ...a, korrespondent: ziel } : a,
    );
    if (bNeu !== b || aNeu.some((a, i) => a !== aktionen[i]))
      await tx.update(workflows).set({ bedingungen: bNeu, aktionen: aNeu }).where(eq(workflows.id, w.id));
  }
}
