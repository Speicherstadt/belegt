import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export * from "./auth-schema.ts";

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

/**
 * Einordnung eines Dokuments: Art, Entstehung und daraus die Frist. Jede Änderung ist eine neue Zeile, versiegelt ab dem
 * Einfügen; es gilt die neueste. So bleibt sichtbar, wer wann was festgelegt hat.
 */
export const einordnungen = pgTable(
  "einordnungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    art: text("art").notNull(),
    /** Tag, an dem das Dokument entstanden, empfangen oder abgesandt wurde (§ 147 Abs. 4 AO) */
    entstanden: date("entstanden").notNull(),
    /** Letzter Tag der Aufbewahrung; NULL bei freier Ablage */
    fristBis: date("frist_bis"),
    titel: text("titel"),
    korrespondent: text("korrespondent"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "einordnungen_art",
      sql`${t.art} in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei')`,
    ),
    check("einordnungen_frist", sql`(${t.art} = 'frei') = (${t.fristBis} is null)`),
    index("einordnungen_dokument").on(t.dokumentId, t.erstelltAm),
  ],
);

/**
 * Sperre (Legal Hold), etwa wegen einer Betriebsprüfung: Dokumente, die im Zeitraum entstanden sind, dürfen nicht
 * gelöscht werden, auch nach Fristende. Aufheben setzt aufgehoben_am; jede Änderung steht im Audit-Log.
 */
export const sperren = pgTable(
  "sperren",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grund: text("grund").notNull(),
    von: date("von").notNull(),
    bis: date("bis").notNull(),
    angelegtAm: timestamp("angelegt_am", { withTimezone: true }).notNull().defaultNow(),
    aufgehobenAm: timestamp("aufgehoben_am", { withTimezone: true }),
  },
  (t) => [
    check("sperren_zeitraum", sql`${t.von} <= ${t.bis}`),
    check("sperren_grund", sql`length(trim(${t.grund})) > 0`),
  ],
);
