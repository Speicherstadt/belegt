import type { Dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { eq, sql } from "drizzle-orm";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { archivnummern, dokumente } from "../db/schema.ts";
import { type Gruppe, gruppenBedingung } from "../einordnung/einordnung.ts";
import { filterBedingung, type OrdnungFilter } from "../ordnung/filter.ts";
import { dateityp } from "./dateityp.ts";

/** Was ein Modul braucht: Datenbank und Speicher kommen von außen, nie aus globalen Variablen */
export interface Umgebung {
  db: Datenbank;
  speicher: Dateispeicher;
}

/** Ein Dokument mit seiner Archivnummer (ASN), die ein Trigger beim Einfügen vergibt */
export type Dokument = typeof dokumente.$inferSelect & { asn: number };

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
  const mimeType = dateityp(eingang.bytes);
  return mitAkteur(db, eingang.akteur, async (tx) => {
    const [neu] = await tx
      .insert(dokumente)
      .values({
        sha256,
        groesse: eingang.bytes.byteLength,
        mimeType,
        dateiname: eingang.dateiname,
        quelle: eingang.quelle,
      })
      .returning();
    const [a] = await tx
      .select({ nummer: archivnummern.nummer })
      .from(archivnummern)
      .where(eq(archivnummern.dokumentId, neu!.id));
    return { ...neu!, asn: a!.nummer };
  });
}

export interface Eintrag extends Dokument {
  /** Neueste Einordnung, NULL solange das Dokument im Eingang liegt */
  art: string | null;
  fristBis: string | null;
  titel: string | null;
  tags: { id: string; name: string; farbe: string }[];
  dokumenttyp: { id: string; name: string } | null;
}

/** „ASN 123“, „asn123“ oder nur „123“: die gesuchte Archivnummer, sonst null */
export function archivnummerAus(suche: string | undefined): number | null {
  const treffer = suche?.trim().match(/^(?:asn\s*)?(\d{1,15})$/i);
  return treffer ? Number(treffer[1]) : null;
}

/**
 * Neueste zuerst. Die Suche geht über den Volltext (Postgres, deutsch: „Rechnungen“ findet „Rechnung“) aus Dateiname,
 * Einordnung, Mail, Tags, Dokumenttyp und Textfeldern, dazu über Teile von Dateiname und Titel (findet auch „_100%“ oder Teilwörter) und über die
 * Archivnummer („ASN 123“).
 */
export async function listen(
  db: Datenbank,
  {
    suche,
    limit = 50,
    gruppe = "alle",
    heute,
    zeitraum,
    ordnung,
  }: {
    suche?: string;
    limit?: number;
    gruppe?: Gruppe;
    heute: string;
    zeitraum?: { von: string; bis: string };
    /** Tags, Dokumenttyp und eigene Felder (server/ordnung/filter.ts) */
    ordnung?: OrdnungFilter;
  },
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
    asn: string;
    art: string | null;
    frist_bis: string | null;
    titel: string | null;
    tags: Eintrag["tags"];
    dokumenttyp: Eintrag["dokumenttyp"];
  }>(sql`
    select d.*, a.nummer as asn, e.art, e.frist_bis::text as frist_bis, e.titel,
           (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'farbe', t.farbe)
                                     order by lower(t.name)), '[]'::json)
              from dokument_tags dt join tags t on t.id = dt.tag_id where dt.dokument_id = d.id) as tags,
           (select json_build_object('id', ty.id, 'name', ty.name)
              from dokument_dokumenttypen dd join dokumenttypen ty on ty.id = dd.dokumenttyp_id
             where dd.dokument_id = d.id) as dokumenttyp
      from dokumente d
      join archivnummern a on a.dokument_id = d.id
      left join lateral (select * from einordnungen x where x.dokument_id = d.id order by x.erstellt_am desc, x.id desc limit 1) e on true
      left join suchtexte st on st.dokument_id = d.id
     where ${gruppenBedingung(gruppe, heute)}
       and ${filterBedingung(ordnung)}
       and (${zeitraum?.von ?? null}::date is null
            or belegt_dokument_tag(d.id) between ${zeitraum?.von ?? null}::date and ${zeitraum?.bis ?? null}::date)
       and (${muster}::text is null or d.dateiname ilike ${muster} or e.titel ilike ${muster}
            or st.vektor @@ websearch_to_tsquery('german', ${suche?.trim() ?? ""})
            or a.nummer = ${archivnummerAus(suche)})
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
    asn: Number(z.asn),
    art: z.art,
    fristBis: z.frist_bis,
    titel: z.titel,
    tags: z.tags,
    dokumenttyp: z.dokumenttyp,
  }));
}

export async function laden(db: Datenbank, id: string): Promise<Dokument | null> {
  const [d] = await db
    .select({ dokument: dokumente, asn: archivnummern.nummer })
    .from(dokumente)
    .innerJoin(archivnummern, eq(archivnummern.dokumentId, dokumente.id))
    .where(eq(dokumente.id, id));
  return d ? { ...d.dokument, asn: d.asn } : null;
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
  /** Bei Tags, Dokumenttyp und Feldern: der Name (heute; null, wenn inzwischen gelöscht) */
  detail: string | null;
}

/**
 * Was das Audit-Log zu einem Dokument verzeichnet: seine Zeile, seine Einordnungen, Tags, Dokumenttyp und Feldwerte und
 * sein Siegel, in der Reihenfolge der Kette
 */
export async function verlauf(db: Datenbank, id: string): Promise<{ ereignisse: Ereignis[]; siegel: string | null }> {
  const ereignisse = await db.execute<{
    seq: string;
    at: Date;
    actor: string | null;
    action: string;
    table_name: string;
    detail: string | null;
  }>(sql`
    select a.seq, a.at, a.actor, a.action, a.table_name,
           case a.table_name
             when 'dokument_tags' then (select t.name from tags t
                                         where t.id::text = coalesce(a.new_value, a.old_value) ->> 'tag_id')
             when 'dokument_dokumenttypen' then (select ty.name from dokumenttypen ty
                                                  where ty.id::text = coalesce(a.new_value, a.old_value) ->> 'dokumenttyp_id')
             when 'feldwerte' then (select f.name from felder f
                                     where f.id::text = coalesce(a.new_value, a.old_value) ->> 'feld_id')
           end as detail
      from audit_log a
     where (a.table_name = 'dokumente' and a.row_id = ${id})
        or (a.table_name = 'einordnungen' and a.new_value ->> 'dokument_id' = ${id})
        or (a.table_name in ('dokument_tags', 'dokument_dokumenttypen', 'feldwerte')
            and coalesce(a.new_value, a.old_value) ->> 'dokument_id' = ${id})
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
      detail: e.detail,
    })),
    siegel: siegel?.digest ?? null,
  };
}

/**
 * Prüft jede Datei im Speicher gegen ihren Hash: fehlt sie oder passt sie nicht mehr, ist das ein Befund. Gelöschte
 * Dokumente haben keine Datei mehr und zählen nicht. Liest jede Datei einmal; bei vielen Dokumenten dauert das.
 */
export async function dateienPruefen(
  { db, speicher }: Umgebung,
  maxBefunde = 100,
): Promise<{ geprueft: number; befunde: Befund[] }> {
  const zeilen = await db.execute<{ id: string; sha256: string }>(sql`
    select d.id, d.sha256 from dokumente d
     where not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am, d.id`);
  const befunde: Befund[] = [];
  const schonGeprueft = new Map<string, string | null>();
  for (const z of zeilen) {
    if (!schonGeprueft.has(z.sha256)) {
      schonGeprueft.set(
        z.sha256,
        await speicher.laden(z.sha256).then(
          () => null,
          (err: { code?: string }) => (err?.code === "ENOENT" ? "Datei fehlt" : "Datei passt nicht zu ihrem Hash"),
        ),
      );
    }
    const befund = schonGeprueft.get(z.sha256);
    if (befund && befunde.length < maxBefunde)
      befunde.push({ art: "datei", tabelle: "dokumente", zeile: z.id, seq: null, befund });
  }
  return { geprueft: zeilen.length, befunde };
}
