import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

/*
 * Für den Alltag: gespeicherte Ansichten des Archivs, die Kacheln der Startseite und Workflows. Einstellungen, keine
 * Unterlage: änderbar und löschbar, jede Änderung mit Akteur im Audit-Log.
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

/**
 * Kacheln der Startseite aus gespeicherten Ansichten, je Zugang in Reihenfolge. Wird eine Ansicht gelöscht, gehen ihre
 * Kacheln mit (bei allen Zugängen, auch im Audit-Log).
 */
export const startKacheln = pgTable(
  "start_kacheln",
  {
    besitzer: text("besitzer").notNull(),
    ansichtId: uuid("ansicht_id")
      .notNull()
      .references(() => gespeicherteAnsichten.id, { onDelete: "cascade" }),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.besitzer, t.ansichtId] }), index("start_kacheln_ansicht").on(t.ansichtId)],
);

/**
 * Workflow (docs/workflows.md): Auslöser, Bedingungen (shared/workflows.ts) und Aktionen (server/workflows/). Nur der
 * Inhaber legt sie an; jede Änderung steht im Audit-Log. Eine Einordnung als Aktion muss ausdrücklich gewählt sein,
 * das prüft Postgres.
 */
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    aktiv: boolean("aktiv").notNull().default(true),
    ausloeser: text("ausloeser", { enum: ["eingang", "eingeordnet"] }).notNull(),
    bedingungen: jsonb("bedingungen").notNull().default({}),
    aktionen: jsonb("aktionen").notNull(),
    /** Trifft der Workflow zu, laufen die folgenden für dieses Dokument nicht */
    anhalten: boolean("anhalten").notNull().default(false),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflows_name").on(sql`lower(${t.name})`),
    check("workflows_name_laenge", sql`length(trim(${t.name})) between 1 and 100`),
    check("workflows_ausloeser", sql`${t.ausloeser} in ('eingang', 'eingeordnet')`),
    check(
      "workflows_aktionen",
      sql`jsonb_typeof(${t.aktionen}) = 'array' and jsonb_array_length(${t.aktionen}) between 1 and 20`,
    ),
    // Einordnen setzt eine Frist und sperrt; ohne ausdrückliche Wahl des Inhabers nie
    check(
      "workflows_einordnung_ausdruecklich",
      // Jede Aktion „einordnen“ hat ausdruecklich = true (genau der Wert true, kein Text, kein Fehlen)
      sql`jsonb_path_query_array(${t.aktionen}, '$[*] ? (@.art == "einordnen")')
          = jsonb_path_query_array(${t.aktionen}, '$[*] ? (@.art == "einordnen" && @.ausdruecklich == true)')`,
    ),
  ],
);

/**
 * Was ein Workflow mit einem Dokument getan hat, je Workflow und Dokument genau einmal, nur anhängen: ausgeführt (mit
 * den Aktionen), trifft nicht, angehalten (ein früherer Workflow hielt an) oder fehler (mit Meldung; die Aktionen sind
 * dann zurückgerollt). workflow_id ohne Fremdschlüssel, damit ein gelöschter Workflow seine Läufe behält.
 */
export const workflowLaeufe = pgTable(
  "workflow_laeufe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    ausloeser: text("ausloeser").notNull(),
    /** Das Ereignis (webhook_ereignisse), das den Lauf auslöste */
    ereignisId: bigint("ereignis_id", { mode: "number" }),
    ergebnis: text("ergebnis", { enum: ["ausgefuehrt", "trifft_nicht", "angehalten", "fehler"] }).notNull(),
    aktionen: jsonb("aktionen"),
    fehler: text("fehler"),
    zeitpunkt: timestamp("zeitpunkt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_laeufe_einmal").on(t.workflowId, t.dokumentId),
    index("workflow_laeufe_zeit").on(t.zeitpunkt),
    index("workflow_laeufe_dokument").on(t.dokumentId),
    check("workflow_laeufe_ergebnis", sql`${t.ergebnis} in ('ausgefuehrt', 'trifft_nicht', 'angehalten', 'fehler')`),
    check("workflow_laeufe_fehler", sql`(${t.ergebnis} = 'fehler') = (${t.fehler} is not null)`),
  ],
);
