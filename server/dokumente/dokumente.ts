import type { Dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { sniff } from "@firsttris/gobd-kern/dateityp";
import { eq, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumente } from "../db/schema.ts";
import { type Gruppe, gruppenBedingung } from "../einordnung/einordnung.ts";

/** Was ein Modul braucht: Datenbank und Speicher kommen von außen, nie aus globalen Variablen */
export interface Umgebung {
  db: Datenbank;
  speicher: Dateispeicher;
}

export type Dokument = typeof dokumente.$inferSelect;

export const QUELLEN = ["upload", "mail", "ordner", "api"] as const;
export type Quelle = (typeof QUELLEN)[number];

/**
 * Nimmt ein Original auf: zuerst die Datei unter ihrem Hash, dann die Zeile, versiegelt und im Audit-Log. Scheitert die
 * Zeile, liegt die Datei schon sicher; eine zweite Aufnahme derselben Datei schreibt sie nicht neu.
 */
export async function aufnehmen(
  { db, speicher }: Umgebung,
  eingang: { bytes: Uint8Array; dateiname: string | null; quelle: Quelle; akteur: string },
): Promise<Dokument> {
  const sha256 = await speicher.speichern(eingang.bytes);
  const mimeType = sniff(eingang.bytes)?.mimeType ?? "application/octet-stream";
  const [neu] = await mitAkteur(db, eingang.akteur, (tx) =>
    tx
      .insert(dokumente)
      .values({
        sha256,
        groesse: eingang.bytes.byteLength,
        mimeType,
        dateiname: eingang.dateiname,
        quelle: eingang.quelle,
      })
      .returning(),
  );
  return neu!;
}

export interface Eintrag extends Dokument {
  /** Neueste Einordnung, NULL solange das Dokument im Eingang liegt */
  art: string | null;
  fristBis: string | null;
  titel: string | null;
}

/** Neueste zuerst; die Suche trifft vorerst Dateiname und Titel (Volltext folgt mit der Texterkennung) */
export async function listen(
  db: Datenbank,
  { suche, limit = 50, gruppe = "alle", heute }: { suche?: string; limit?: number; gruppe?: Gruppe; heute: string },
): Promise<Eintrag[]> {
  const muster = suche?.trim() ? `%${suche.trim().replace(/[\\%_]/g, (z) => `\\${z}`)}%` : null;
  const zeilen = await db.execute<{
    id: string;
    sha256: string;
    groesse: string;
    mime_type: string;
    dateiname: string | null;
    quelle: string;
    eingegangen_am: Date;
    art: string | null;
    frist_bis: string | null;
    titel: string | null;
  }>(sql`
    select d.*, e.art, e.frist_bis::text as frist_bis, e.titel
      from dokumente d
      left join lateral (select * from einordnungen x where x.dokument_id = d.id order by x.erstellt_am desc, x.id desc limit 1) e on true
     where ${gruppenBedingung(gruppe, heute)}
       and (${muster}::text is null or d.dateiname ilike ${muster} or e.titel ilike ${muster})
     order by d.eingegangen_am desc, d.id desc
     limit ${limit}`);
  return [...zeilen].map((z) => ({
    id: z.id,
    sha256: z.sha256,
    groesse: Number(z.groesse),
    mimeType: z.mime_type,
    dateiname: z.dateiname,
    quelle: z.quelle,
    eingegangenAm: new Date(z.eingegangen_am),
    art: z.art,
    fristBis: z.frist_bis,
    titel: z.titel,
  }));
}

export async function laden(db: Datenbank, id: string): Promise<Dokument | null> {
  const [d] = await db.select().from(dokumente).where(eq(dokumente.id, id));
  return d ?? null;
}

export interface Befund {
  art: string;
  tabelle: string;
  zeile: string | null;
  seq: number | null;
  befund: string;
}

/** Befunde zu Hash-Kette, Kopf und Siegeln aus Postgres (belegt_integrity_problems) */
export async function pruefen(db: Datenbank): Promise<Befund[]> {
  const zeilen = await db.execute<{
    art: string;
    tabelle: string;
    zeile: string | null;
    seq: string | null;
    befund: string;
  }>(sql`select art, tabelle, zeile, seq, befund from belegt_integrity_problems(100)`);
  return [...zeilen].map((z) => ({ ...z, seq: z.seq === null ? null : Number(z.seq) }));
}

export interface Ereignis {
  seq: number;
  at: string;
  akteur: string | null;
  aktion: string;
  tabelle: string;
}

/** Was das Audit-Log zu einem Dokument verzeichnet: seine Zeile und sein Siegel, in der Reihenfolge der Kette */
export async function verlauf(db: Datenbank, id: string): Promise<{ ereignisse: Ereignis[]; siegel: string | null }> {
  const ereignisse = await db.execute<{
    seq: string;
    at: Date;
    actor: string | null;
    action: string;
    table_name: string;
  }>(sql`
    select a.seq, a.at, a.actor, a.action, a.table_name
      from audit_log a
     where (a.table_name = 'dokumente' and a.row_id = ${id})
        or (a.table_name = 'einordnungen' and a.new_value ->> 'dokument_id' = ${id})
        or (a.table_name = 'seals' and a.new_value ->> 'row_id' in (
              select ${id} union all select x.id::text from einordnungen x where x.dokument_id = ${id}::uuid))
     order by a.seq`);
  const [siegel] = await db.execute<{ digest: string }>(
    sql`select digest from seals where table_name = 'dokumente' and row_id = ${id}`,
  );
  return {
    ereignisse: [...ereignisse].map((e) => ({
      seq: Number(e.seq),
      at: new Date(e.at).toISOString(),
      akteur: e.actor,
      aktion: e.action,
      tabelle: e.table_name,
    })),
    siegel: siegel?.digest ?? null,
  };
}
