import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Feldtyp } from "../../shared/ordnung.ts";
import { mitAkteur, type Tx } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumentDokumenttypen, dokumente, dokumentTags, dokumenttypen, feldwerte, tags } from "../db/schema.ts";
import { aktuelle, EinordnungEingabe, einordnenIn } from "../einordnung/einordnung.ts";
import { type Feld, felderListen, feldwertAus, feldwertSpalten, konflikt } from "./ordnung.ts";

/*
 * Tags, Dokumenttyp und Feldwerte an Dokumenten, einzeln und als Sammelbearbeitung. Alles in einer Transaktion mit
 * Akteur; jede Zeile steht im Audit-Log. Die Sammelbearbeitung kann auch einordnen, mit denselben Regeln wie die
 * Einordnung eines einzelnen Dokuments (Trigger in Postgres: nicht nach der Löschung).
 */

const Id = z.uuid();

/** Einordnung in der Sammelbearbeitung: entstanden „eingang“ nimmt den Tag des Eingangs jedes Dokuments */
const SammelEinordnung = EinordnungEingabe.extend({
  entstanden: z.union([EinordnungEingabe.shape.entstanden, z.literal("eingang")]),
  /** Nur Dokumente im Eingang; schon eingeordnete werden übersprungen. false ordnet alle neu ein (neue Version) */
  nurOffene: z.boolean().default(true),
});

export const Aenderung = z
  .object({
    tagsHinzu: z.array(Id).max(50).default([]),
    tagsWeg: z.array(Id).max(50).default([]),
    /** undefined lässt den Typ, null entfernt ihn */
    dokumenttyp: Id.nullable().optional(),
    /** wert null entfernt den Wert */
    felder: z
      .array(z.object({ feldId: Id, wert: z.unknown() }))
      .max(50)
      .default([]),
    einordnung: SammelEinordnung.optional(),
  })
  .refine(
    (a) =>
      a.tagsHinzu.length + a.tagsWeg.length + a.felder.length > 0 ||
      a.dokumenttyp !== undefined ||
      a.einordnung !== undefined,
    { message: "Keine Änderung" },
  );
export type Aenderung = z.infer<typeof Aenderung>;

export const Sammlung = z.intersection(z.object({ ids: z.array(Id).min(1).max(500) }), Aenderung);

export interface Ordnung {
  tags: { id: string; name: string; farbe: string }[];
  dokumenttyp: { id: string; name: string; vorgabeArt: string | null } | null;
  felder: { feldId: string; name: string; typ: Feldtyp; wert: string | number | boolean }[];
}

/** Tags, Dokumenttyp und Feldwerte eines Dokuments */
export async function ordnungZu(db: Datenbank, dokumentId: string): Promise<Ordnung> {
  const [t, typ, werte, alleFelder] = await Promise.all([
    db
      .select({ id: tags.id, name: tags.name, farbe: tags.farbe })
      .from(dokumentTags)
      .innerJoin(tags, eq(tags.id, dokumentTags.tagId))
      .where(eq(dokumentTags.dokumentId, dokumentId))
      .orderBy(sql`lower(${tags.name})`),
    db
      .select({ id: dokumenttypen.id, name: dokumenttypen.name, vorgabeArt: dokumenttypen.vorgabeArt })
      .from(dokumentDokumenttypen)
      .innerJoin(dokumenttypen, eq(dokumenttypen.id, dokumentDokumenttypen.dokumenttypId))
      .where(eq(dokumentDokumenttypen.dokumentId, dokumentId)),
    db.select().from(feldwerte).where(eq(feldwerte.dokumentId, dokumentId)),
    felderListen(db),
  ]);
  const wertJeFeld = new Map(werte.map((w) => [w.feldId, w]));
  return {
    tags: t,
    dokumenttyp: typ[0] ?? null,
    felder: alleFelder.flatMap((f) => {
      const w = wertJeFeld.get(f.id);
      const wert = w ? feldwertAus(w) : null;
      return wert === null ? [] : [{ feldId: f.id, name: f.name, typ: f.typ, wert }];
    }),
  };
}

/** Prüft eine Änderung vorab: Tags, Typ und Felder gibt es, jeder Wert passt zu seinem Feld */
async function vorbereiten(tx: Tx, a: Aenderung) {
  const ids = [...new Set([...a.tagsHinzu, ...a.tagsWeg])];
  if (ids.length) {
    const da = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, ids));
    if (da.length !== ids.length) throw konflikt("Unbekannter Tag");
  }
  if (a.dokumenttyp) {
    const [typ] = await tx
      .select({ id: dokumenttypen.id })
      .from(dokumenttypen)
      .where(eq(dokumenttypen.id, a.dokumenttyp));
    if (!typ) throw konflikt("Unbekannter Dokumenttyp");
  }
  const jeId = new Map<string, Feld>((await felderListen(tx)).map((f) => [f.id, f]));
  return a.felder.map(({ feldId, wert }) => {
    const feld = jeId.get(feldId);
    if (!feld) throw konflikt("Unbekanntes Feld");
    if (wert === null || wert === undefined || wert === "") return { feldId, spalten: null };
    const geprueft = (() => {
      try {
        return feldwertSpalten(feld, wert);
      } catch {
        throw Object.assign(konflikt(`Ungültiger Wert für „${feld.name}“`), { ungueltig: true });
      }
    })();
    return { feldId, spalten: geprueft };
  });
}

export type Ergebnis = { id: string; ok: true; eingeordnet: boolean } | { id: string; ok: false; fehler: string };

/** Fehler eines Dokuments als Text: Meldungen der Trigger (check_violation) und von fristende, nie SQL */
function meldung(err: unknown): string {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const quelle = e?.code ? e : e?.cause;
  if (quelle?.code === "23514") return quelle.message ?? "Nicht erlaubt";
  if (err instanceof Error && !("code" in err) && !("cause" in err && err.cause)) return err.message;
  return "Nicht möglich";
}

async function eingangstag(tx: Tx, id: string): Promise<string | null> {
  const [d] = await tx.execute<{ tag: string }>(
    sql`select (eingegangen_am at time zone 'Europe/Berlin')::date::text as tag from dokumente where id = ${id}`,
  );
  return d?.tag ?? null;
}

/** Wendet eine geprüfte Änderung auf ein Dokument an */
async function anwenden(
  tx: Tx,
  id: string,
  a: Aenderung,
  werte: Awaited<ReturnType<typeof vorbereiten>>,
): Promise<{ eingeordnet: boolean }> {
  const tag = await eingangstag(tx, id);
  if (!tag) throw new Error("Nicht gefunden");
  if (a.tagsWeg.length)
    await tx.delete(dokumentTags).where(and(eq(dokumentTags.dokumentId, id), inArray(dokumentTags.tagId, a.tagsWeg)));
  for (const tagId of a.tagsHinzu)
    await tx.insert(dokumentTags).values({ dokumentId: id, tagId }).onConflictDoNothing();
  if (a.dokumenttyp === null) await tx.delete(dokumentDokumenttypen).where(eq(dokumentDokumenttypen.dokumentId, id));
  else if (a.dokumenttyp)
    await tx
      .insert(dokumentDokumenttypen)
      .values({ dokumentId: id, dokumenttypId: a.dokumenttyp })
      .onConflictDoUpdate({
        target: dokumentDokumenttypen.dokumentId,
        set: { dokumenttypId: a.dokumenttyp, geaendertAm: sql`now()` },
        // Gleicher Typ: keine Änderung, kein Eintrag im Audit-Log
        setWhere: sql`${dokumentDokumenttypen.dokumenttypId} is distinct from excluded.dokumenttyp_id`,
      });
  for (const { feldId, spalten } of werte) {
    const wo = and(eq(feldwerte.dokumentId, id), eq(feldwerte.feldId, feldId));
    if (!spalten) await tx.delete(feldwerte).where(wo);
    else
      await tx
        .insert(feldwerte)
        .values({ dokumentId: id, feldId, ...spalten })
        .onConflictDoUpdate({
          target: [feldwerte.dokumentId, feldwerte.feldId],
          set: { ...spalten, geaendertAm: sql`now()` },
          setWhere: sql`(${feldwerte.wertText}, ${feldwerte.wertZahl}, ${feldwerte.wertDatum}, ${feldwerte.wertBool})
            is distinct from (excluded.wert_text, excluded.wert_zahl, excluded.wert_datum, excluded.wert_bool)`,
        });
  }
  if (!a.einordnung) return { eingeordnet: false };
  const { nurOffene, ...einordnung } = a.einordnung;
  if (nurOffene && (await aktuelle(tx, id))) return { eingeordnet: false };
  await einordnenIn(tx, id, {
    ...einordnung,
    entstanden: einordnung.entstanden === "eingang" ? tag : einordnung.entstanden,
  });
  return { eingeordnet: true };
}

/**
 * Ändert ein oder mehrere Dokumente in einer Transaktion. Jedes Dokument läuft in einem Savepoint, damit sein Fehler
 * im Ergebnis steht; scheitert eines, wird am Ende alles zurückgerollt (ok: false), sonst gilt alles (ok: true).
 * Eine ungültige Änderung (unbekannter Tag, falscher Wert) wirft vorab einen Konflikt.
 */
export async function sammeln(
  db: Datenbank,
  ids: string[],
  a: Aenderung,
  akteur: string,
): Promise<{ ok: boolean; ergebnisse: Ergebnis[] }> {
  const ergebnisse: Ergebnis[] = [];
  const zurueck = Symbol("zurück");
  try {
    await mitAkteur(db, akteur, async (tx) => {
      const werte = await vorbereiten(tx, a);
      for (const id of [...new Set(ids)]) {
        try {
          const r = await tx.transaction((sp) => anwenden(sp as Tx, id, a, werte));
          ergebnisse.push({ id, ok: true, eingeordnet: r.eingeordnet });
        } catch (err) {
          ergebnisse.push({ id, ok: false, fehler: meldung(err) });
        }
      }
      if (ergebnisse.some((e) => !e.ok)) throw zurueck;
    });
  } catch (err) {
    if (err !== zurueck) throw err;
    return { ok: false, ergebnisse };
  }
  return { ok: true, ergebnisse };
}

/** Ob ein Dokument existiert (für 404 vor einer Änderung) */
export async function gibtEs(db: Datenbank, id: string): Promise<boolean> {
  return (await db.select({ id: dokumente.id }).from(dokumente).where(eq(dokumente.id, id))).length > 0;
}
