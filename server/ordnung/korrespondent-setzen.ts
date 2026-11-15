import { eq, sql } from "drizzle-orm";
import type { Tx } from "../db/akteur.ts";
import { dokumentKorrespondenten, korrespondenten } from "../db/schema.ts";

/*
 * Korrespondent eines Dokuments setzen, ohne weitere Abhängigkeiten: Die Einordnung (server/einordnung/) nutzt das
 * auch, und ordnung.ts hängt selbst an der Einordnung.
 */

export type Korrespondent = typeof korrespondenten.$inferSelect;

/**
 * Der Korrespondent mit diesem Namen (ohne Groß- und Kleinschreibung), angelegt, falls es ihn nicht gibt; gekürzt auf
 * 300 Zeichen. Neu angelegte lernt Belegt („automatisch“) wie alle anderen.
 */
export async function korrespondentMitNamen(tx: Tx, name: string): Promise<Korrespondent> {
  const n = name.trim().slice(0, 300);
  if (!n) throw new Error("Name fehlt");
  await tx.execute(sql`insert into korrespondenten (name) values (${n}) on conflict ((lower(name))) do nothing`);
  const [k] = await tx.select().from(korrespondenten).where(sql`lower(${korrespondenten.name}) = lower(${n})`);
  return k!;
}

/** Der Korrespondent mit diesem Namen (ohne Groß- und Kleinschreibung), ohne ihn anzulegen; null, wenn es ihn nicht gibt */
export async function korrespondentVorhanden(tx: Tx, name: string): Promise<Korrespondent | null> {
  const [k] = await tx
    .select()
    .from(korrespondenten)
    .where(sql`lower(${korrespondenten.name}) = lower(${name.trim().slice(0, 300)})`);
  return k ?? null;
}

/** Setzt den Korrespondenten eines Dokuments (null entfernt ihn); derselbe noch einmal ändert nichts */
export async function korrespondentSetzen(tx: Tx, dokumentId: string, korrespondentId: string | null) {
  if (korrespondentId === null) {
    await tx.delete(dokumentKorrespondenten).where(eq(dokumentKorrespondenten.dokumentId, dokumentId));
    return;
  }
  await tx
    .insert(dokumentKorrespondenten)
    .values({ dokumentId, korrespondentId })
    .onConflictDoUpdate({
      target: dokumentKorrespondenten.dokumentId,
      set: { korrespondentId, geaendertAm: sql`now()` },
      // Gleicher Korrespondent: keine Änderung, kein Eintrag im Audit-Log
      setWhere: sql`${dokumentKorrespondenten.korrespondentId} is distinct from excluded.korrespondent_id`,
    });
}
