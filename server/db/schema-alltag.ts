import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Für den Alltag: gespeicherte Ansichten des Archivs. Einstellungen, keine Unterlage: änderbar und löschbar, jede
 * Änderung mit Akteur im Audit-Log.
 */

/**
 * Eine gespeicherte Ansicht: Suche und Filter des Archivs als Suchparameter (shared/archivansicht.ts). Gehört der
 * Person, die sie anlegt (besitzer ist die ID des Zugangs); fuer_alle zeigt sie auch den anderen Zugängen außer dem
 * Prüfer, das darf nur der Inhaber.
 */
export const gespeicherteAnsichten = pgTable(
  "gespeicherte_ansichten",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    besitzer: text("besitzer").notNull(),
    name: text("name").notNull(),
    parameter: jsonb("parameter").notNull(),
    fuerAlle: boolean("fuer_alle").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gespeicherte_ansichten_name").on(t.besitzer, sql`lower(${t.name})`),
    index("gespeicherte_ansichten_fuer_alle").on(t.fuerAlle),
    check("gespeicherte_ansichten_name_laenge", sql`length(trim(${t.name})) between 1 and 100`),
    check("gespeicherte_ansichten_parameter", sql`jsonb_typeof(${t.parameter}) = 'object'`),
  ],
);
