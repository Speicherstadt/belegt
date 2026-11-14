import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/*
 * Tabellen von Belegt. Audit-Log, Kopf der Kette, Siegel und sealed_tables legt die erste Migration aus der Vorlage
 * von @firsttris/gobd-kern an; sie stehen bewusst nicht hier, sonst legte drizzle-kit sie ein zweites Mal an.
 */

/** Ein eingegangenes Original. Versiegelt ab dem Einfügen: Was einmal angekommen ist, ändert sich nicht. */
export const dokumente = pgTable(
  "dokumente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 der Datei; unter diesem Namen liegt sie im Speicher */
    sha256: text("sha256").notNull(),
    groesse: bigint("groesse", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    dateiname: text("dateiname"),
    /** Woher: upload, mail, ordner, api */
    quelle: text("quelle").notNull(),
    eingegangenAm: timestamp("eingegangen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("dokumente_sha256", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("dokumente_groesse", sql`${t.groesse} >= 0`),
    index("dokumente_eingegangen").on(t.eingegangenAm),
    index("dokumente_sha256_idx").on(t.sha256),
  ],
);
