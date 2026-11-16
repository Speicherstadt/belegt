import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

/**
 * Ergebnis der Prüfung einer E-Rechnung mit dem KoSIT-Validator (server/erechnung/pruefung.ts). Abgeleitet wie inhalte
 * und ansichten: Mit der bestätigten Löschung geht es mit, danach kommt keins mehr hinein.
 */
export const erechnungPruefungen = pgTable(
  "erechnung_pruefungen",
  {
    dokumentId: uuid("dokument_id")
      .primaryKey()
      .references(() => dokumente.id),
    gueltig: boolean("gueltig").notNull(),
    szenario: text("szenario"),
    fehler: integer("fehler").notNull(),
    warnungen: integer("warnungen").notNull(),
    /** Die ersten Fehler und Warnungen: [{stufe, code, text}] */
    meldungen: jsonb("meldungen").notNull().default(sql`'[]'::jsonb`),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("erechnung_pruefungen_meldungen", sql`jsonb_typeof(${t.meldungen}) = 'array'`)],
);
