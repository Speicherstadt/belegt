import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

/*
 * Zuordnungsregeln (shared/abgleich.ts) an Korrespondenten, Tags und Dokumenttypen: Algorithmus, Text und Groß- und
 * Kleinschreibung. Vorgabe „automatisch“: Belegt lernt aus den eigenen Einordnungen und schlägt nur vor.
 */
const abgleichSpalten = () => ({
  abgleich: text("abgleich").notNull().default("automatisch"),
  abgleichText: text("abgleich_text").notNull().default(""),
  grossKleinEgal: boolean("gross_klein_egal").notNull().default(true),
});

const abgleichPruefungen = (tabelle: string, t: { abgleich: AnyPgColumn; abgleichText: AnyPgColumn }) => [
  check(
    `${tabelle}_abgleich`,
    sql`${t.abgleich} in ('keiner', 'irgendein_wort', 'alle_woerter', 'exakt', 'regex', 'unscharf', 'automatisch')`,
  ),
  check(`${tabelle}_abgleich_text`, sql`length(${t.abgleichText}) <= 500`),
];

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
    ...abgleichSpalten(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tags_name_eindeutig").on(sql`lower(${t.name})`),
    check("tags_name", sql`length(trim(${t.name})) between 1 and 100`),
    check(
      "tags_farbe",
      sql`${t.farbe} in ('grau', 'rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'violett', 'rosa')`,
    ),
    ...abgleichPruefungen("tags", t),
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
    ...abgleichSpalten(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dokumenttypen_name_eindeutig").on(sql`lower(${t.name})`),
    check("dokumenttypen_name", sql`length(trim(${t.name})) between 1 and 100`),
    check(
      "dokumenttypen_vorgabe_art",
      sql`${t.vorgabeArt} is null or ${t.vorgabeArt} in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei')`,
    ),
    ...abgleichPruefungen("dokumenttypen", t),
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

/**
 * Korrespondent als Eintrag einer Liste; Name ohne Groß- und Kleinschreibung eindeutig. Die Einordnung behält den Text,
 * der beim Einordnen galt (versiegelt); die Zuordnung zum Listeneintrag steht in dokument_korrespondenten.
 */
export const korrespondenten = pgTable(
  "korrespondenten",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ...abgleichSpalten(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("korrespondenten_name_eindeutig").on(sql`lower(${t.name})`),
    check("korrespondenten_name", sql`length(trim(${t.name})) between 1 and 300`),
    ...abgleichPruefungen("korrespondenten", t),
  ],
);

/** Höchstens ein Korrespondent je Dokument; Metadaten wie der Dokumenttyp, jede Änderung im Audit-Log */
export const dokumentKorrespondenten = pgTable(
  "dokument_korrespondenten",
  {
    dokumentId: uuid("dokument_id")
      .primaryKey()
      .references(() => dokumente.id),
    id: uuid("id").notNull().unique().defaultRandom(),
    korrespondentId: uuid("korrespondent_id")
      .notNull()
      .references(() => korrespondenten.id),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dokument_korrespondenten_korrespondent").on(t.korrespondentId)],
);

/**
 * Was die Zuordnungsregeln für ein Dokument im Eingang vorschlagen, einmal nach dem Lesen des Inhalts ausgewertet
 * (server/abgleich/vorschlaege.ts). Aus dem Inhalt abgeleitet: geht mit der Löschung mit, nicht im Audit-Log.
 */
export const zuordnungVorschlaege = pgTable("zuordnung_vorschlaege", {
  dokumentId: uuid("dokument_id")
    .primaryKey()
    .references(() => dokumente.id),
  vorschlag: jsonb("vorschlag").notNull(),
  erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
});
