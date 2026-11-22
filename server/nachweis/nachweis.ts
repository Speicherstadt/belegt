import { sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { type Ereignis, laden, verlauf } from "../dokumente/dokumente.ts";
import type { Sicht } from "../zugang/sicht.ts";

/*
 * Nachweis eines Dokuments (docs/pruefung.md#nachweis): was Belegt über ein Original belegen kann, an einer Stelle.
 * Hash und Siegel zeigen, dass es unverändert ist; der erste Zeitstempel nach seinem Eingang, dass es spätestens zu dieser
 * Zeit so vorlag (er geht über den Kopf der Hash-Kette, die den Eingang enthält); die letzte Prüfung der Kette, dass
 * sie seitdem stimmt. Als JSON für Programme und als PDF (nachweis-pdf.ts) für Menschen.
 */

export interface Nachweis {
  dokument: {
    id: string;
    dateiname: string | null;
    sha256: string;
    groesse: number;
    asn: number;
    eingegangenAm: string;
  };
  /** Nummer des Eingangs im Audit-Log */
  eingangSeq: number;
  siegel: string | null;
  ereignisse: Ereignis[];
  zeitstempel: { dienst: string; zeit: string; seq: number; hash: string; seriennummer: string } | null;
  pruefung: { ok: boolean; geprueftAm: string; befunde: number } | null;
}

export async function nachweisZu(
  db: Datenbank,
  id: string,
  { notizen = true, sicht }: { notizen?: boolean; sicht?: Sicht } = {},
): Promise<Nachweis | null> {
  const d = await laden(db, id);
  if (!d) return null;
  const v = await verlauf(db, id, { notizen, sicht });
  const eingang = v.ereignisse.find((e) => e.tabelle === "dokumente" && e.aktion === "INSERT");
  const eingangSeq = eingang?.seq ?? 0;
  const [z] = await db.execute<{ dienst: string; zeit: Date; seq: string; hash: string; seriennummer: string }>(
    sql`select dienst, zeit, seq, hash, seriennummer from zeitstempel where seq >= ${eingangSeq}
         order by seq limit 1`,
  );
  const [p] = await db.execute<{ ok: boolean; geprueft_am: Date; befunde: string }>(
    sql`select ok, geprueft_am, befunde from kettenpruefungen order by geprueft_am desc limit 1`,
  );
  return {
    dokument: {
      id: d.id,
      dateiname: d.dateiname,
      sha256: d.sha256,
      groesse: d.groesse,
      asn: d.asn,
      eingegangenAm: new Date(d.eingegangenAm).toISOString(),
    },
    eingangSeq,
    siegel: v.siegel,
    ereignisse: v.ereignisse,
    zeitstempel: z
      ? {
          dienst: z.dienst,
          zeit: new Date(z.zeit).toISOString(),
          seq: Number(z.seq),
          hash: z.hash,
          seriennummer: z.seriennummer,
        }
      : null,
    pruefung: p ? { ok: p.ok, geprueftAm: new Date(p.geprueft_am).toISOString(), befunde: Number(p.befunde) } : null,
  };
}
