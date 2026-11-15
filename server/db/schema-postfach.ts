import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { dokumente, quellen } from "./schema.ts";

/*
 * Aktionen im Postfach nach dem Abholen (server/mail/aktionen.ts, docs/eingang.md#nach-dem-abholen). Vorbild ist
 * Paperless-ngx (src/paperless_mail/mail.py): Die Aktion läuft erst, wenn die Mail aufgenommen ist, und jede Mail wird
 * mit Ordner, UID und UIDVALIDITY festgehalten, damit nichts doppelt geschieht.
 */

/**
 * Eine abgeholte Mail, an der noch eine Aktion aussteht oder ausstand. Eingetragen erst, nachdem die Mail im Archiv liegt
 * (Transaktion festgeschrieben); IMAP über Ordner, UIDVALIDITY und UID, JMAP über die Email-ID. Im Audit-Log.
 */
export const postfachMails = pgTable(
  "postfach_mails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quelleId: uuid("quelle_id")
      .notNull()
      .references(() => quellen.id),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    sha256: text("sha256").notNull(),
    /** Ordner beim Abholen; ändert sich der Ordner der Quelle, gilt die UID weiter für diesen */
    ordner: text("ordner").notNull(),
    uidValidity: bigint("uid_validity", { mode: "number" }),
    uid: bigint("uid", { mode: "number" }),
    jmapId: text("jmap_id"),
    /** Eingang des Dokuments im Archiv; ab hier zählt die Wartezeit vor dem Löschen */
    archiviertAm: timestamp("archiviert_am", { withTimezone: true }).notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    /** offen, erledigt, entfallen (Mail nicht mehr da, Aktion abgeschaltet) oder fehlgeschlagen (Versuche aufgebraucht) */
    status: text("status", { enum: ["offen", "erledigt", "entfallen", "fehlgeschlagen"] })
      .notNull()
      .default("offen"),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuch: timestamp("naechster_versuch", { withTimezone: true }).notNull().defaultNow(),
    letzterFehler: text("letzter_fehler"),
  },
  (t) => [
    check("postfach_mails_status", sql`${t.status} in ('offen', 'erledigt', 'entfallen', 'fehlgeschlagen')`),
    check(
      "postfach_mails_adresse",
      sql`(${t.uid} is not null and ${t.uidValidity} is not null) or ${t.jmapId} is not null`,
    ),
    uniqueIndex("postfach_mails_imap").on(t.quelleId, t.ordner, t.uidValidity, t.uid),
    uniqueIndex("postfach_mails_jmap").on(t.quelleId, t.jmapId),
    index("postfach_mails_offen").on(t.quelleId, t.status, t.naechsterVersuch),
  ],
);

/**
 * Protokoll jeder Aktion im Postfach: was mit welcher Mail geschah, wann und mit welchem Ergebnis. Wächst nur an
 * (Trigger belegt_append_only) und steht im Audit-Log.
 */
export const postfachAktionen = pgTable(
  "postfach_aktionen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postfachMailId: uuid("postfach_mail_id")
      .notNull()
      .references(() => postfachMails.id),
    quelleId: uuid("quelle_id")
      .notNull()
      .references(() => quellen.id),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    aktion: text("aktion", { enum: ["keine", "gelesen", "markieren", "verschieben", "loeschen"] }).notNull(),
    ziel: text("ziel"),
    ordner: text("ordner").notNull(),
    uidValidity: bigint("uid_validity", { mode: "number" }),
    uid: bigint("uid", { mode: "number" }),
    jmapId: text("jmap_id"),
    /** ausgefuehrt, entfallen (nichts zu tun) oder fehler (wird begrenzt wiederholt) */
    ergebnis: text("ergebnis", { enum: ["ausgefuehrt", "entfallen", "fehler"] }).notNull(),
    meldung: text("meldung"),
    zeit: timestamp("zeit", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("postfach_aktionen_aktion", sql`${t.aktion} in ('keine', 'gelesen', 'markieren', 'verschieben', 'loeschen')`),
    check("postfach_aktionen_ergebnis", sql`${t.ergebnis} in ('ausgefuehrt', 'entfallen', 'fehler')`),
    index("postfach_aktionen_quelle").on(t.quelleId, t.zeit),
  ],
);
