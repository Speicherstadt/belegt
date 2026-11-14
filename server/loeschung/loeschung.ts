import type { Dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumente, einordnungen, loeschungen } from "../db/schema.ts";

export type Loeschung = typeof loeschungen.$inferSelect;

/** Fehler, den der Trigger belegt_loeschung_pruefen meldet (check_violation): als 409 mit seiner Meldung an den Nutzer */
export function regelVerletzt(err: unknown): string | null {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const quelle = e?.code ? e : e?.cause;
  return quelle?.code === "23514" ? (quelle.message ?? "Nicht erlaubt") : null;
}

/**
 * Beantragt die Löschung; frei Abgelegtes löscht dieselbe Person sofort (keine Pflicht, keine zweite Person nötig).
 * War das Dokument je anders eingeordnet, bestätigt eine zweite Person, wie es der Trigger verlangt.
 */
export async function beantragen(
  db: Datenbank,
  speicher: Dateispeicher,
  dokumentId: string,
  akteur: string,
): Promise<Loeschung> {
  const arten = await db
    .select({ art: einordnungen.art })
    .from(einordnungen)
    .where(eq(einordnungen.dokumentId, dokumentId));
  const frei = arten.length > 0 && arten.every((e) => e.art === "frei");
  const [neu] = await mitAkteur(db, akteur, (tx) =>
    tx
      .insert(loeschungen)
      .values({
        dokumentId,
        beantragtVon: akteur,
        ...(frei ? { bestaetigtVon: akteur, bestaetigtAm: new Date() } : {}),
      })
      .returning(),
  );
  if (frei) await dateiEntfernen(db, speicher, dokumentId);
  return neu!;
}

/** Bestätigt einen offenen Antrag; der Trigger lehnt ab, wenn dieselbe Person bestätigt oder die Lage sich geändert hat */
export async function bestaetigen(
  db: Datenbank,
  speicher: Dateispeicher,
  id: string,
  akteur: string,
): Promise<Loeschung | null> {
  const [l] = await mitAkteur(db, akteur, (tx) =>
    tx
      .update(loeschungen)
      .set({ bestaetigtVon: akteur, bestaetigtAm: new Date() })
      .where(and(eq(loeschungen.id, id), isNull(loeschungen.bestaetigtAm)))
      .returning(),
  );
  if (l) await dateiEntfernen(db, speicher, l.dokumentId);
  return l ?? null;
}

export async function zurueckziehen(db: Datenbank, id: string, akteur: string): Promise<boolean> {
  const zeilen = await mitAkteur(db, akteur, (tx) =>
    tx
      .delete(loeschungen)
      .where(and(eq(loeschungen.id, id), isNull(loeschungen.bestaetigtAm)))
      .returning({ id: loeschungen.id }),
  );
  return zeilen.length > 0;
}

export async function fuerDokument(db: Datenbank, dokumentId: string): Promise<Loeschung | null> {
  const [l] = await db.select().from(loeschungen).where(eq(loeschungen.dokumentId, dokumentId));
  return l ?? null;
}

export async function listen(db: Datenbank) {
  return db
    .select({
      id: loeschungen.id,
      dokumentId: loeschungen.dokumentId,
      dateiname: dokumente.dateiname,
      beantragtVon: loeschungen.beantragtVon,
      beantragtAm: loeschungen.beantragtAm,
      bestaetigtVon: loeschungen.bestaetigtVon,
      bestaetigtAm: loeschungen.bestaetigtAm,
    })
    .from(loeschungen)
    .innerJoin(dokumente, eq(dokumente.id, loeschungen.dokumentId))
    .orderBy(desc(loeschungen.beantragtAm));
}

/**
 * Entfernt die Datei nach der bestätigten Löschung, außer ein anderes, nicht gelöschtes Dokument hat denselben Inhalt
 * (gleicher Hash, eine Datei). Läuft nach dem Commit: Scheitert es, liegt die Datei noch da, gelöscht ist sie trotzdem.
 */
async function dateiEntfernen(db: Datenbank, speicher: Dateispeicher, dokumentId: string): Promise<void> {
  const [d] = await db.select({ sha256: dokumente.sha256 }).from(dokumente).where(eq(dokumente.id, dokumentId));
  if (!d) return;
  const [andere] = await db.execute<{ n: string }>(sql`
    select count(*) as n from dokumente x
     where x.sha256 = ${d.sha256} and x.id <> ${dokumentId}
       and not exists (select 1 from loeschungen l where l.dokument_id = x.id and l.bestaetigt_am is not null)`);
  if (Number(andere?.n ?? 0) > 0) return;
  // Die Löschung steht in der Datenbank; lehnt der Speicher ab (S3: noch gesperrt), bleibt die Datei bis zum Ende der
  // Sperre liegen, ohne dass die bestätigte Löschung scheitert. Ausliefern tut Belegt sie ohnehin nicht mehr (410).
  await speicher
    .entfernen(d.sha256)
    .catch((err) => console.error(`Datei ${d.sha256} nicht entfernt: ${err instanceof Error ? err.message : err}`));
}

/** Bedingung: Dokument ist nicht (bestätigt) gelöscht; d ist die Zeile aus dokumente */
export const nichtGeloescht = sql`not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)`;
