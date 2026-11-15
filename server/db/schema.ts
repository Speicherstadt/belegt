import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export * from "./auth-schema.ts";
export * from "./schema-ordnung.ts";

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
 * Archivnummer (ASN) eines Dokuments: fortlaufend in der Reihenfolge des Eingangs, nie wiederverwendet. Ein Trigger
 * auf dokumente vergibt sie beim Einfügen; versiegelt wie das Dokument. dokumente selbst bleibt unberührt, denn eine
 * neue Spalte dort ließe sich für den Altbestand nicht mehr füllen.
 */
export const archivnummern = pgTable("archivnummern", {
  dokumentId: uuid("dokument_id")
    .primaryKey()
    .references(() => dokumente.id),
  id: uuid("id").notNull().unique().defaultRandom(),
  nummer: bigint("nummer", { mode: "number" }).notNull().unique().generatedAlwaysAsIdentity(),
});

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

/**
 * Löschung eines Dokuments: beantragt, dann von einer zweiten Person bestätigt (frei Abgelegtes darf dieselbe Person
 * sofort löschen). Ab der Bestätigung versiegelt; die Zeile in dokumente bleibt als Löschnachweis mit Hash, die Datei
 * ist weg. Ob gelöscht werden darf, prüft ein Trigger in Postgres (Frist, Sperren, zwei Personen).
 */
export const loeschungen = pgTable(
  "loeschungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .unique()
      .references(() => dokumente.id),
    beantragtVon: text("beantragt_von").notNull(),
    beantragtAm: timestamp("beantragt_am", { withTimezone: true }).notNull().defaultNow(),
    bestaetigtVon: text("bestaetigt_von"),
    bestaetigtAm: timestamp("bestaetigt_am", { withTimezone: true }),
  },
  (t) => [check("loeschungen_bestaetigung", sql`(${t.bestaetigtVon} is null) = (${t.bestaetigtAm} is null)`)],
);

/**
 * Eine Mail: das Original ist ein Dokument (message/rfc822), hier stehen die daraus gelesenen Angaben für Suche,
 * Anzeige und Unterhaltungen. Versiegelt ab dem Einfügen, wie das Original; neu erzeugbar aus der .eml.
 */
export const mails = pgTable(
  "mails",
  {
    dokumentId: uuid("dokument_id")
      .primaryKey()
      .references(() => dokumente.id),
    id: uuid("id").notNull().unique().defaultRandom(),
    messageId: text("message_id"),
    antwortAuf: text("antwort_auf"),
    verweise: text("verweise").array().notNull(),
    von: text("von"),
    an: text("an").array().notNull(),
    betreff: text("betreff").notNull(),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }),
    text: text("text").notNull(),
  },
  (t) => [index("mails_message_id").on(t.messageId), index("mails_von").on(t.von)],
);

/** Anhang einer Mail: selbst ein Dokument, mit Verweis auf die Mail; versiegelt ab dem Einfügen */
export const mailAnhaenge = pgTable(
  "mail_anhaenge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailDokumentId: uuid("mail_dokument_id")
      .notNull()
      .references(() => dokumente.id),
    anhangDokumentId: uuid("anhang_dokument_id")
      .notNull()
      .unique()
      .references(() => dokumente.id),
    eingebettet: boolean("eingebettet").notNull(),
  },
  (t) => [index("mail_anhaenge_mail").on(t.mailDokumentId)],
);

/** Regeln für Vorschläge beim Einordnen (shared/regeln.ts); Änderungen stehen im Audit-Log */
export const regeln = pgTable(
  "regeln",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    bedingung: jsonb("bedingung").notNull(),
    art: text("art").notNull(),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    /** Zusätzlich vorgeschlagen: Tags, Dokumenttyp und Feldwerte (server/ordnung/vorschlag.ts) */
    ordnung: jsonb("ordnung"),
  },
  (t) => [
    check(
      "regeln_art",
      sql`${t.art} in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei')`,
    ),
  ],
);

/**
 * Postfach, das der Worker per IMAP abruft. Das Passwort liegt nur verschlüsselt in ciphertext (server/crypto.ts),
 * das Audit-Log lässt diese Spalte aus. letzte_uid merkt sich, bis wohin abgeholt ist; ändert sich uid_validity, ist
 * das Postfach neu nummeriert und der Abruf beginnt von vorn (doppelte Mails erkennt der Import).
 */
export const quellen = pgTable(
  "quellen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(993),
    tls: boolean("tls").notNull().default(true),
    benutzer: text("benutzer").notNull(),
    ordner: text("ordner").notNull().default("INBOX"),
    ciphertext: bytea("ciphertext").notNull(),
    letzteUid: bigint("letzte_uid", { mode: "number" }).notNull().default(0),
    uidValidity: bigint("uid_validity", { mode: "number" }),
    letzterAbruf: timestamp("letzter_abruf", { withTimezone: true }),
    letzterFehler: text("letzter_fehler"),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    /** imap oder jmap */
    art: text("art", { enum: ["imap", "jmap"] })
      .notNull()
      .default("imap"),
    /** JMAP: Stand (state) nach dem letzten vollständigen Abruf */
    jmapStand: text("jmap_stand"),
    /** IMAP mit OAuth: microsoft oder google; ciphertext hält dann das Refresh-Token statt eines Passworts */
    oauth: text("oauth", { enum: ["microsoft", "google"] }),
  },
  (t) => [
    check("quellen_port", sql`${t.port} between 1 and 65535`),
    check("quellen_art", sql`${t.art} in ('imap', 'jmap')`),
    check("quellen_oauth", sql`${t.oauth} is null or (${t.oauth} in ('microsoft', 'google') and ${t.art} = 'imap')`),
  ],
);

/**
 * Angaben zum Betrieb für Verfahrensdokumentation, Z3-Export und Fristen; genau eine Zeile, protokolliert.
 * Was die Software selbst tut, schreibt Belegt in die Verfahrensdokumentation; hier steht nur, was sie nicht wissen kann.
 */
export const einstellungen = pgTable(
  "einstellungen",
  {
    id: smallint("id").primaryKey().default(1),
    firma: text("firma").notNull().default(""),
    anschrift: text("anschrift").notNull().default(""),
    verantwortlich: text("verantwortlich").notNull().default(""),
    /** Kredit-, Wertpapierinstitut oder unter Versicherungsaufsicht: Buchungsbelege 10 statt 8 Jahre (Art. 97 § 19a EGAO) */
    aufsicht: boolean("aufsicht").notNull().default(false),
    /** Wie, wohin und wie oft gesichert wird, und wer die Wiederherstellung prüft */
    datensicherung: text("datensicherung").notNull().default(""),
    /** Papier nach dem Scannen: aufbewahrt oder vernichtet, wer scannt, wer prüft */
    scannen: text("scannen").notNull().default(""),
    ergaenzungen: text("ergaenzungen").notNull().default(""),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("einstellungen_eine_zeile", sql`${t.id} = 1`)],
);

/**
 * Zugang für Programme (Schnittstelle): gespeichert ist nur der SHA-256 des Tokens. „lesen“ liest Dokumente,
 * „schreiben“ nimmt zusätzlich Dokumente und Mails auf und ordnet ein; verwalten, löschen oder bestätigen kann kein Token.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    recht: text("recht", { enum: ["lesen", "schreiben"] }).notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    widerrufenAm: timestamp("widerrufen_am", { withTimezone: true }),
  },
  (t) => [
    check("api_tokens_recht", sql`${t.recht} in ('lesen', 'schreiben')`),
    check("api_tokens_name", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Ereignisse für Webhooks; Trigger auf dokumente, einordnungen und loeschungen schreiben sie, nur anhängen */
export const webhookEreignisse = pgTable("webhook_ereignisse", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  art: text("art").notNull(),
  dokumentId: uuid("dokument_id").notNull(),
  zeitpunkt: timestamp("zeitpunkt", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Empfänger für Webhooks: Belegt meldet Ereignisse per POST, signiert mit HMAC-SHA256. Das Geheimnis liegt
 * verschlüsselt in ciphertext. Zugestellt wird jedes Ereignis ab dem Anlegen; was angekommen ist, steht in
 * webhook_zustellungen (eine Nummer als Zeiger reichte nicht: Sequenzen vergeben Nummern nicht in Commit-Reihenfolge).
 */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    arten: text("arten").array().notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    letzteZustellung: timestamp("letzte_zustellung", { withTimezone: true }),
    letzterFehler: text("letzter_fehler"),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("webhooks_url", sql`${t.url} ~ '^https?://'`)],
);

export const webhookZustellungen = pgTable(
  "webhook_zustellungen",
  {
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id),
    ereignisId: bigint("ereignis_id", { mode: "number" })
      .notNull()
      .references(() => webhookEreignisse.id),
    zugestelltAm: timestamp("zugestellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.webhookId, t.ereignisId] })],
);

/**
 * Was Belegt aus einer Datei liest: Text aus PDFs, Kopfdaten einer E-Rechnung (XML oder in einem PDF eingebettet).
 * Abgeleitet und neu erzeugbar, deshalb weder versiegelt noch im Audit-Log; das Original bleibt maßgeblich.
 */
export const inhalte = pgTable("inhalte", {
  dokumentId: uuid("dokument_id")
    .primaryKey()
    .references(() => dokumente.id),
  text: text("text").notNull().default(""),
  erechnung: jsonb("erechnung"),
  fehler: text("fehler"),
  /** Text kommt aus der Texterkennung (Scan), nicht aus der Datei selbst */
  ocr: boolean("ocr").notNull().default(false),
  erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bis zu welchem Tag die Datei eines Hashs im S3-Bucket gesperrt ist (Object Lock); abgeleitet aus den Fristen,
 * damit der Worker nur verlängert, was sich geändert hat.
 */
export const objektsperren = pgTable("objektsperren", {
  sha256: text("sha256").primaryKey(),
  bis: date("bis").notNull(),
  gesetztAm: timestamp("gesetzt_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Dateien, die der Speicher nach einer bestätigten Löschung noch nicht entfernen durfte (S3: noch gesperrt); der
 * Worker versucht es wieder, bis es gelingt.
 */
export const offeneEntfernungen = pgTable("offene_entfernungen", {
  sha256: text("sha256").primaryKey(),
  seit: timestamp("seit", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Zeitstempel nach RFC 3161 über den Kopf der Hash-Kette: belegt, dass alle Einträge bis seq zu diesem Zeitpunkt so
 * bestanden. Versiegelt ab dem Einfügen.
 */
export const zeitstempel = pgTable("zeitstempel", {
  id: uuid("id").primaryKey().defaultRandom(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  /** SHA-256 des Kopfs der Kette (hex), über den der Zeitstempel geht */
  hash: text("hash").notNull(),
  dienst: text("dienst").notNull(),
  zeit: timestamp("zeit", { withTimezone: true }).notNull(),
  seriennummer: text("seriennummer").notNull(),
  token: bytea("token").notNull(),
  erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vorschläge eines Sprachmodells zur Einordnung (lokal, KI_URL); nur ein Vorschlag, eingeordnet wird erst, wenn ein
 * Mensch ihn übernimmt. Abgeleitet und neu erzeugbar, deshalb ohne Siegel und Audit-Log.
 */
export const kiVorschlaege = pgTable("ki_vorschlaege", {
  dokumentId: uuid("dokument_id")
    .primaryKey()
    .references(() => dokumente.id),
  vorschlag: jsonb("vorschlag"),
  modell: text("modell").notNull(),
  fehler: text("fehler"),
  erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ansicht als PDF für Office-Dateien, die der Browser nicht zeigt (Word, Excel, PowerPoint, OpenDocument, RTF);
 * erzeugt der Worker über den Vorschau-Dienst (VORSCHAU_URL). Abgeleitet wie inhalte: weder versiegelt noch im
 * Audit-Log, das Original bleibt maßgeblich; mit der bestätigten Löschung geht sie mit.
 */
export const ansichten = pgTable("ansichten", {
  dokumentId: uuid("dokument_id")
    .primaryKey()
    .references(() => dokumente.id),
  pdf: bytea("pdf"),
  fehler: text("fehler"),
  erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Links auf das Original, ohne Anmeldung, nur dieses eine Dokument und nur bis gueltig_bis: kurzlebig für „Öffnen mit …“
 * (zweck oeffnen, eine andere App holt eine Kopie) oder vom Inhaber geteilt für 1 bis 30 Tage (zweck teilen). Den Link
 * gibt es nur in der Antwort, hier nur seinen Hash; jede Freigabe steht im Audit-Log und lässt sich nicht ändern.
 */
export const freigaben = pgTable(
  "freigaben",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    tokenHash: text("token_hash").notNull().unique(),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    zweck: text("zweck").notNull().default("oeffnen"),
  },
  (t) => [
    check("freigaben_zweck", sql`${t.zweck} in ('oeffnen', 'teilen')`),
    // Geteilt wird höchstens 30 Tage; ein Tag Spielraum für die Uhr des Servers
    check(
      "freigaben_teilen_dauer",
      sql`${t.zweck} <> 'teilen' or ${t.gueltigBis} <= ${t.erstelltAm} + interval '31 days'`,
    ),
  ],
);

/** Widerruf eines geteilten Links, einmal je Link; ergänzt statt freigaben zu ändern, die nur anwächst */
export const freigabeWiderrufe = pgTable("freigabe_widerrufe", {
  freigabeId: uuid("freigabe_id")
    .primaryKey()
    .references(() => freigaben.id),
  widerrufenVon: text("widerrufen_von").notNull(),
  widerrufenAm: timestamp("widerrufen_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Jeder Abruf eines geteilten Links, nur mit dem Zeitpunkt: Wer abruft, ist nicht angemeldet, und eine IP-Adresse wäre
 * ein personenbezogenes Datum, das sich aus dieser Tabelle, die nur anwächst, nie mehr löschen ließe.
 */
export const freigabeAbrufe = pgTable(
  "freigabe_abrufe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    freigabeId: uuid("freigabe_id")
      .notNull()
      .references(() => freigaben.id),
    abgerufenAm: timestamp("abgerufen_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("freigabe_abrufe_freigabe").on(t.freigabeId)],
);
