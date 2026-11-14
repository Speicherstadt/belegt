import { desc, eq, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { zeitstempel } from "../db/schema.ts";
import { type Abfragen, zeitstempelHolen } from "./rfc3161.ts";

/**
 * Holt einen Zeitstempel über den Kopf der Hash-Kette, wenn seit dem letzten etwas dazukam. Der Eintrag des Zeitstempels
 * selbst (und sein Siegel) zählt dabei nicht, sonst holte jeder Lauf einen neuen.
 */
export async function zeitstempelSetzen(
  db: Datenbank,
  dienst: string,
  { abfragen, abstandStunden = 0 }: { abfragen?: Abfragen; abstandStunden?: number } = {},
) {
  const [letzter] = await db
    .select({ seq: zeitstempel.seq, zeit: zeitstempel.zeit })
    .from(zeitstempel)
    .orderBy(desc(zeitstempel.seq))
    .limit(1);
  // Höchstens einer je Abstand (im Worker einer am Tag)
  if (letzter && Date.now() - letzter.zeit.getTime() < abstandStunden * 3_600_000) return null;
  const [neu] = await db.execute<{ ja: boolean }>(sql`
    select exists (
      select 1 from audit_log a
       where a.seq > ${letzter?.seq ?? 0}
         and a.table_name <> 'zeitstempel'
         and not (a.table_name = 'seals' and a.new_value ->> 'table_name' = 'zeitstempel')) as ja`);
  if (!neu?.ja) return null;
  const [kopf] = await db.execute<{ seq: string; hash: string }>(
    sql`select seq, encode(hash, 'hex') as hash from audit_chain where id = 1`,
  );
  if (!kopf) return null;
  const z = await zeitstempelHolen(dienst, Buffer.from(kopf.hash, "hex"), abfragen);
  const [zeile] = await mitAkteur(db, "system:zeitstempel", (tx) =>
    tx
      .insert(zeitstempel)
      .values({
        seq: Number(kopf.seq),
        hash: kopf.hash,
        dienst,
        zeit: z.zeit,
        seriennummer: z.seriennummer,
        token: Buffer.from(z.token),
      })
      .returning({ id: zeitstempel.id, seq: zeitstempel.seq, zeit: zeitstempel.zeit }),
  );
  return zeile!;
}

export async function listen(db: Datenbank) {
  return db
    .select({
      id: zeitstempel.id,
      seq: zeitstempel.seq,
      hash: zeitstempel.hash,
      dienst: zeitstempel.dienst,
      zeit: zeitstempel.zeit,
      seriennummer: zeitstempel.seriennummer,
    })
    .from(zeitstempel)
    .orderBy(desc(zeitstempel.seq));
}

export async function token(db: Datenbank, id: string) {
  const [z] = await db
    .select({ token: zeitstempel.token, seq: zeitstempel.seq })
    .from(zeitstempel)
    .where(eq(zeitstempel.id, id));
  return z ?? null;
}
