import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Feldtyp, Feldwert } from "../../shared/ordnung.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumenttypen, tags } from "../db/schema.ts";
import { felderListen, feldwertAus, feldwertSpalten, konflikt } from "./ordnung.ts";

/*
 * Vorschläge für Tags, Dokumenttyp und Feldwerte, wie sie eine Regel speichert. Ein Vorschlag ist nur ein Vorschlag:
 * Gesetzt wird er erst, wenn ein Mensch ihn übernimmt. Was seit dem Anlegen der Regel gelöscht wurde, fällt weg.
 */

const Id = z.uuid();

export const OrdnungsVorschlag = z.object({
  tags: z.array(Id).max(20).default([]),
  dokumenttyp: Id.nullable().default(null),
  felder: z
    .array(z.object({ feldId: Id, wert: z.unknown() }))
    .max(20)
    .default([]),
});
export type OrdnungsVorschlag = z.infer<typeof OrdnungsVorschlag>;

export interface AufgeloesterVorschlag {
  tags: { id: string; name: string; farbe: string }[];
  dokumenttyp: { id: string; name: string } | null;
  felder: { feldId: string; name: string; typ: Feldtyp; wert: Feldwert }[];
}

/** Prüft einen Vorschlag beim Anlegen einer Regel und gibt ihn mit gespeicherten Werten zurück (Betrag in Cent) */
export async function vorschlagPruefen(db: Datenbank, o: OrdnungsVorschlag): Promise<OrdnungsVorschlag> {
  if (o.tags.length) {
    const da = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, o.tags));
    if (da.length !== new Set(o.tags).size) throw konflikt("Unbekannter Tag");
  }
  if (o.dokumenttyp) {
    const da = await db
      .select({ id: dokumenttypen.id })
      .from(dokumenttypen)
      .where(inArray(dokumenttypen.id, [o.dokumenttyp]));
    if (!da.length) throw konflikt("Unbekannter Dokumenttyp");
  }
  const jeId = new Map((await felderListen(db)).map((f) => [f.id, f]));
  return {
    tags: [...new Set(o.tags)],
    dokumenttyp: o.dokumenttyp,
    felder: o.felder.map(({ feldId, wert }) => {
      const feld = jeId.get(feldId);
      if (!feld) throw konflikt("Unbekanntes Feld");
      try {
        return { feldId, wert: feldwertAus(feldwertSpalten(feld, wert)) };
      } catch {
        throw Object.assign(konflikt(`Ungültiger Wert für „${feld.name}“`), { ungueltig: true });
      }
    }),
  };
}

/** Der Vorschlag mit Namen; Gelöschtes und Werte, die nicht mehr passen (etwa eine entfernte Option), fallen weg */
export async function vorschlagAufloesen(db: Datenbank, roh: unknown): Promise<AufgeloesterVorschlag | null> {
  const o = OrdnungsVorschlag.safeParse(roh ?? {});
  if (!o.success) return null;
  const { tags: tagIds, dokumenttyp, felder } = o.data;
  const [t, typ, alleFelder] = await Promise.all([
    tagIds.length
      ? db.select({ id: tags.id, name: tags.name, farbe: tags.farbe }).from(tags).where(inArray(tags.id, tagIds))
      : [],
    dokumenttyp
      ? db
          .select({ id: dokumenttypen.id, name: dokumenttypen.name })
          .from(dokumenttypen)
          .where(inArray(dokumenttypen.id, [dokumenttyp]))
      : [],
    felder.length ? felderListen(db) : [],
  ]);
  const jeId = new Map(alleFelder.map((f) => [f.id, f]));
  const aufgeloest: AufgeloesterVorschlag = {
    tags: t,
    dokumenttyp: typ[0] ?? null,
    felder: felder.flatMap(({ feldId, wert }) => {
      const feld = jeId.get(feldId);
      if (!feld) return [];
      try {
        const w = feldwertAus(feldwertSpalten(feld, wert));
        return w === null ? [] : [{ feldId, name: feld.name, typ: feld.typ, wert: w }];
      } catch {
        return [];
      }
    }),
  };
  return aufgeloest.tags.length || aufgeloest.dokumenttyp || aufgeloest.felder.length ? aufgeloest : null;
}
