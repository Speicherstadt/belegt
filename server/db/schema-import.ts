import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/*
 * Umzug aus Paperless-ngx (server/paperless/): Quellen mit API-Token, Läufe, das Ergebnis je Paperless-Dokument und
 * die Zuordnung von Dokumenttypen und Tags zu einer Art. Alles im Audit-Log; das Ergebnis je Dokument ist versiegelt,
 * denn es belegt den Abgleich der Prüfsumme.
 */

/** Eine Instanz von Paperless-ngx, aus der der Worker über die REST-API importiert; das Token nur verschlüsselt */
export const paperlessQuellen = pgTable(
  "paperless_quellen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Adresse ohne Pfad am Ende, etwa https://paperless.firma.de; nur dorthin geht das Token */
    url: text("url").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("paperless_quellen_url", sql`${t.url} ~ '^https?://[^/]+(/.*[^/])?$'`),
    check("paperless_quellen_name", sql`length(trim(${t.name})) between 1 and 200`),
  ],
);

/**
 * Ein Lauf: über die API einer Quelle oder aus einem hochgeladenen Export (ZIP im Importordner). Der Worker setzt den
 * Stand; abbrechen bittet ihn, nach dem laufenden Dokument aufzuhören. Die Zahlen stehen in import_eintraege.
 */
export const importe = pgTable(
  "importe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    art: text("art", { enum: ["api", "export"] }).notNull(),
    quelleId: uuid("quelle_id").references(() => paperlessQuellen.id),
    /** Name der hochgeladenen Datei (Export) */
    dateiname: text("dateiname"),
    status: text("status", { enum: ["wartet", "laeuft", "fertig", "abgebrochen", "fehler"] })
      .notNull()
      .default("wartet"),
    /** Zahl der Dokumente in Paperless-ngx, sobald bekannt */
    gesamt: integer("gesamt"),
    /** Wer um den Abbruch gebeten hat; der Worker hört nach dem laufenden Dokument auf */
    abbrechenVon: text("abbrechen_von"),
    meldung: text("meldung"),
    /** Was beim Abbilden nicht eins zu eins ging, etwa ein Feldtyp, den Belegt nicht kennt */
    hinweise: text("hinweise").array().notNull().default(sql`'{}'::text[]`),
    gestartetVon: text("gestartet_von").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    begonnenAm: timestamp("begonnen_am", { withTimezone: true }),
    beendetAm: timestamp("beendet_am", { withTimezone: true }),
  },
  (t) => [
    check("importe_art", sql`${t.art} in ('api', 'export')`),
    check("importe_quelle", sql`(${t.art} = 'api') = (${t.quelleId} is not null)`),
    check("importe_status", sql`${t.status} in ('wartet', 'laeuft', 'fertig', 'abgebrochen', 'fehler')`),
    index("importe_quelle_idx").on(t.quelleId),
  ],
);

/**
 * Ergebnis je Paperless-Dokument und Lauf, nur ergänzen: übernommen (neues Dokument), doppelt (dasselbe Original lag
 * schon im Archiv, nur verknüpft) oder fehler mit Grund. Titel, Korrespondent und Entstehung aus Paperless-ngx sind der
 * Vorschlag für die Einordnung. pruefsumme ist die aus Paperless-ngx (MD5 oder SHA-256), sha256 die des geladenen
 * Originals.
 */
export const importEintraege = pgTable(
  "import_eintraege",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => importe.id),
    paperlessId: integer("paperless_id").notNull(),
    ergebnis: text("ergebnis", { enum: ["uebernommen", "doppelt", "fehler"] }).notNull(),
    dokumentId: uuid("dokument_id").references(() => dokumente.id),
    pruefsumme: text("pruefsumme"),
    sha256: text("sha256"),
    grund: text("grund"),
    titel: text("titel"),
    korrespondent: text("korrespondent"),
    entstanden: date("entstanden"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("import_eintraege_ergebnis", sql`${t.ergebnis} in ('uebernommen', 'doppelt', 'fehler')`),
    check("import_eintraege_dokument", sql`(${t.ergebnis} = 'fehler') = (${t.dokumentId} is null)`),
    check("import_eintraege_grund", sql`(${t.ergebnis} = 'fehler') = (${t.grund} is not null)`),
    unique("import_eintraege_eindeutig").on(t.importId, t.paperlessId),
    index("import_eintraege_dokument_idx").on(t.dokumentId),
  ],
);

/**
 * Dokumenttyp oder Tag aus Paperless-ngx (Name, ohne Groß- und Kleinschreibung) → Art: Ein passendes Dokument wird beim
 * Import gleich eingeordnet. Freiwillig fehlt, denn dafür braucht es ein Datum.
 */
export const importZuordnungen = pgTable(
  "import_zuordnungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    art: text("art", { enum: ["dokumenttyp", "tag"] }).notNull(),
    name: text("name").notNull(),
    zielArt: text("ziel_art", { enum: ["buecher", "zoll", "beleg", "geschaeftsbrief", "sonstige", "frei"] }).notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("import_zuordnungen_eindeutig").on(t.art, sql`lower(${t.name})`),
    check("import_zuordnungen_art", sql`${t.art} in ('dokumenttyp', 'tag')`),
    check("import_zuordnungen_name", sql`length(trim(${t.name})) between 1 and 200`),
    check(
      "import_zuordnungen_ziel",
      sql`${t.zielArt} in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'frei')`,
    ),
  ],
);
