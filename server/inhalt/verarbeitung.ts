import { sql } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { LESBAR } from "./inhalt.ts";

/**
 * Wie viele Dokumente noch auf ihren Text warten (der Worker liest ihn nach dem Eingang, server/inhalt/inhalt.ts):
 * lesbare Formate ohne Eintrag in inhalte, ohne bestätigte Löschung. Für die Glocke in der Kopfzeile
 */
export async function verarbeitungsstand(db: Datenbank): Promise<{ textOffen: number }> {
  const lesbar = sql`array[${sql.join(
    LESBAR.map((b) => sql`${b}`),
    sql`, `,
  )}]::text[]`;
  const [z] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from dokumente d
     where d.mime_type = any(${lesbar})
       and not exists (select 1 from inhalte i where i.dokument_id = d.id)
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)`);
  return { textOffen: z?.n ?? 0 };
}
