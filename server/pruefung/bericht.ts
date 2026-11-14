import { formatPruefwert } from "@firsttris/gobd-kern/pruefwert";
import { sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";

/**
 * Was zu einem Prüfbericht neben den Befunden gehört: Zeitpunkt, Kopf der Hash-Kette als Prüfwert (wer ihn notiert,
 * kann später zeigen, dass bis dahin nichts verändert wurde) und die Zahl der geprüften Zeilen.
 */
export interface Bericht {
  zeitpunkt: string;
  pruefwert: string | null;
  dokumente: number;
  geloescht: number;
  siegel: number;
  protokoll: number;
}

export async function bericht(db: Datenbank): Promise<Bericht> {
  const [z] = await db.execute<{
    dokumente: string;
    geloescht: string;
    siegel: string;
    protokoll: string;
    seq: string | null;
    hash: string | null;
  }>(sql`
    select (select count(*) from dokumente) as dokumente,
           (select count(*) from loeschungen where bestaetigt_am is not null) as geloescht,
           (select count(*) from seals) as siegel,
           (select count(*) from audit_log) as protokoll,
           k.seq, encode(k.hash, 'hex') as hash
      from (select 1) x left join audit_chain k on k.id = 1`);
  return {
    zeitpunkt: new Date().toISOString(),
    pruefwert: z?.seq && z.hash ? formatPruefwert({ seq: Number(z.seq), hash: z.hash }) : null,
    dokumente: Number(z?.dokumente ?? 0),
    geloescht: Number(z?.geloescht ?? 0),
    siegel: Number(z?.siegel ?? 0),
    protokoll: Number(z?.protokoll ?? 0),
  };
}
