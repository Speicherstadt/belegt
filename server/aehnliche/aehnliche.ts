import { sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import type { Zeitraum } from "../zugang/einladungen.ts";

/*
 * Ähnliche Dokumente aus dem Volltext, ohne Erweiterung wie pg_trgm: Aus dem Suchtext des Dokuments (suchtexte, deutsch
 * normalisiert) nimmt Belegt die Lexeme, die darin oft und im übrigen Archiv selten vorkommen (Häufigkeit mal
 * log(Dokumente / Dokumente mit dem Lexem), wie tf-idf), fragt nach jedem davon mit ODER und ordnet die Treffer nach
 * ts_rank. Lexeme, die nur dieses Dokument hat, helfen nicht und fallen weg, Zahlen und sehr kurze Wörter auch.
 */

export interface Aehnliches {
  id: string;
  asn: number;
  dateiname: string | null;
  titel: string | null;
  mimeType: string;
  vorschaubild: boolean;
}

/** Bis zu limit ähnliche Dokumente, ohne gelöschte; mit Zeitraum (Prüfer) nur solche darin */
export async function aehnliche(
  db: Datenbank,
  id: string,
  { limit = 5, zeitraum }: { limit?: number; zeitraum?: Zeitraum } = {},
): Promise<Aehnliches[]> {
  const zeilen = await db.execute<{
    id: string;
    asn: string;
    dateiname: string | null;
    titel: string | null;
    mime_type: string;
    vorschaubild: boolean;
  }>(sql`
    with eigen as (
      select u.lexeme, coalesce(array_length(u.positions, 1), 1) as tf
        from suchtexte s, unnest(s.vektor) u
       where s.dokument_id = ${id}
         and length(u.lexeme) >= 3
         and u.lexeme !~ '^[0-9.,:/-]+$'
         and u.lexeme !~ '[''\\\\:&|!()<>*]'
       order by tf desc, u.lexeme
       limit 40),
    gesamt as (select greatest(count(*), 1) as n from suchtexte),
    gewichtet as (
      select e.lexeme, e.tf * ln((select n from gesamt)::numeric / df.n) as gewicht
        from eigen e
        cross join lateral (select count(*) as n from suchtexte s
                             where s.vektor @@ quote_literal(e.lexeme)::tsquery) df
       where df.n > 1
       order by gewicht desc, e.lexeme
       limit 12),
    frage as (select string_agg(quote_literal(lexeme), ' | ')::tsquery as q from gewichtet)
    select d.id, a.nummer as asn, d.dateiname, e.titel, d.mime_type,
           exists (select 1 from vorschaubilder v where v.dokument_id = d.id and v.bild is not null) as vorschaubild
      from frage f
      join suchtexte st on f.q is not null and st.vektor @@ f.q
      join dokumente d on d.id = st.dokument_id
      join archivnummern a on a.dokument_id = d.id
      left join lateral (select titel from einordnungen x where x.dokument_id = d.id
                          order by x.erstellt_am desc, x.id desc limit 1) e on true
     where d.id <> ${id}
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
       and (${zeitraum?.von ?? null}::date is null
            or belegt_dokument_tag(d.id) between ${zeitraum?.von ?? null}::date and ${zeitraum?.bis ?? null}::date)
     order by ts_rank(st.vektor, f.q) desc, d.eingegangen_am desc, d.id
     limit ${limit}`);
  return [...zeilen].map((z) => ({
    id: z.id,
    asn: Number(z.asn),
    dateiname: z.dateiname,
    titel: z.titel,
    mimeType: z.mime_type,
    vorschaubild: z.vorschaubild,
  }));
}
