import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

/*
 * Ordnung neben der GoBD-Art (shared/ordnung.ts): Tags, Dokumenttypen und eigene Felder. Metadaten, nicht das
 * Original: änderbar, aber jede Änderung steht mit Akteur im Audit-Log. Für ein gelöschtes Dokument lehnt Postgres
 * neue Zuordnungen ab; vorhandene bleiben als Teil des Löschnachweises.
 */

/** Tag, vom Inhaber angelegt; Name ohne Groß- und Kleinschreibung eindeutig, Farbe aus FARBEN */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    farbe: text("farbe").notNull().default("grau"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tags_name_eindeutig").on(sql`lower(${t.name})`),
    check("tags_name", sql`length(trim(${t.name})) between 1 and 100`),
    check(
      "tags_farbe",
      sql`${t.farbe} in ('grau', 'rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'violett', 'rosa')`,
    ),
  ],
);

export const dokumentTags = pgTable(
  "dokument_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("dokument_tags_eindeutig").on(t.dokumentId, t.tagId), index("dokument_tags_tag").on(t.tagId)],
);

/** Frei definierbarer Dokumenttyp („Vertrag“); die Vorgabe-Art ist nur ein Vorschlag beim Einordnen */
export const dokumenttypen = pgTable(
  "dokumenttypen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    vorgabeArt: text("vorgabe_art"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dokumenttypen_name_eindeutig").on(sql`lower(${t.name})`),
    check("dokumenttypen_name", sql`length(trim(${t.name})) between 1 and 100`),
    check(
      "dokumenttypen_vorgabe_art",
      sql`${t.vorgabeArt} is null or ${t.vorgabeArt} in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei')`,
    ),
  ],
);

/** Höchstens ein Dokumenttyp je Dokument */
export const dokumentDokumenttypen = pgTable(
  "dokument_dokumenttypen",
  {
    dokumentId: uuid("dokument_id")
      .primaryKey()
      .references(() => dokumente.id),
    id: uuid("id").notNull().unique().defaultRandom(),
    dokumenttypId: uuid("dokumenttyp_id")
      .notNull()
      .references(() => dokumenttypen.id),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dokument_dokumenttypen_typ").on(t.dokumenttypId)],
);

/** Eigenes Feld; der Typ ist fest, sobald das Feld angelegt ist. optionen nur bei auswahl */
export const felder = pgTable(
  "felder",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    typ: text("typ").notNull(),
    optionen: text("optionen").array().notNull().default(sql`'{}'::text[]`),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("felder_name_eindeutig").on(sql`lower(${t.name})`),
    check("felder_name", sql`length(trim(${t.name})) between 1 and 100`),
    check("felder_typ", sql`${t.typ} in ('text', 'zahl', 'betrag', 'datum', 'ja_nein', 'auswahl', 'link')`),
    check("felder_optionen", sql`(${t.typ} = 'auswahl') = (cardinality(${t.optionen}) > 0)`),
  ],
);

/**
 * Wert eines eigenen Feldes an einem Dokument, genau eine Spalte gesetzt: text, auswahl und link in wert_text, zahl und
 * betrag (ganze Cent) in wert_zahl, datum in wert_datum, ja_nein in wert_bool.
 */
export const feldwerte = pgTable(
  "feldwerte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    feldId: uuid("feld_id")
      .notNull()
      .references(() => felder.id),
    wertText: text("wert_text"),
    wertZahl: bigint("wert_zahl", { mode: "number" }),
    wertDatum: date("wert_datum"),
    wertBool: boolean("wert_bool"),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("feldwerte_eindeutig").on(t.dokumentId, t.feldId),
    index("feldwerte_feld").on(t.feldId),
    check("feldwerte_ein_wert", sql`num_nonnulls(${t.wertText}, ${t.wertZahl}, ${t.wertDatum}, ${t.wertBool}) = 1`),
  ],
);
