import { sql } from "drizzle-orm";

/** Ausschnitt aus dem eigenen Text des Dokuments (Inhalt oder Mail), nur wenn die Suche darin trifft */
export function ausschnittAus(suche: string) {
  if (!suche) return sql`null::text`;
  const frage = sql`websearch_to_tsquery('german', ${suche})`;
  return sql`(select ts_headline('german', q.text, ${frage},
                'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "')
                from (select coalesce(nullif(i.text, ''), m.text) as text
                        from (select 1) eins
                        left join inhalte i on i.dokument_id = d.id
                        left join mails m on m.dokument_id = d.id) q
               where q.text is not null and to_tsvector('german', q.text) @@ ${frage})`;
}
