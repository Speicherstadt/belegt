import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Ergebnis je Lauf des Backup-Containers (deploy/backup): Sicherung oder Test-Restore. Den Eintrag schreibt der
 * Container mit dem Eigentümerzugang; die App liest nur (server/db/rollen.ts). Nur ergänzen, mit Audit-Log.
 */
export const backupStatus = pgTable(
  "backup_status",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
    /** backup oder restore_check */
    art: text("art").notNull(),
    ok: boolean("ok").notNull(),
    /** Kurze ID des Snapshots im restic-Repository */
    snapshot: text("snapshot"),
    bytes: bigint("bytes", { mode: "number" }),
    meldung: text("meldung").notNull().default(""),
    /** Ziel der Sicherung ohne Zugangsdaten, etwa s3:s3.eu-central-1.amazonaws.com/bucket/belegt */
    ziel: text("ziel"),
    /** Rhythmus, etwa „täglich um 03:15, Test-Restore alle 7 Tage“ */
    zeitplan: text("zeitplan"),
  },
  (t) => [
    check("backup_status_art", sql`${t.art} in ('backup', 'restore_check')`),
    index("backup_status_art_am").on(t.art, t.am),
  ],
);

/**
 * Benachrichtigungen per Mail (docs/betrieb.md#benachrichtigungen): je Anlass an oder aus mit Schwellen, Empfänger.
 * Genau eine Zeile, protokolliert; die App ändert sie, löscht sie aber nie (server/db/rollen.ts).
 */
export const benachrichtigungEinstellungen = pgTable(
  "benachrichtigung_einstellungen",
  {
    id: smallint("id").primaryKey().default(1),
    /** Je Anlass { an, tage?, anzahl? }; was fehlt, nimmt die Vorgabe (server/benachrichtigungen/einstellungen.ts) */
    anlaesse: jsonb("anlaesse").notNull().default({}),
    /** An den Inhaber */
    anInhaber: boolean("an_inhaber").notNull().default(true),
    /** Weitere Adressen, etwa ein Postfach der IT */
    weitereEmpfaenger: text("weitere_empfaenger").array().notNull().default(sql`'{}'::text[]`),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("benachrichtigung_einstellungen_eine_zeile", sql`${t.id} = 1`)],
);

/**
 * Jede gesendete (oder gescheiterte) Benachrichtigung: Anlass, Zustand (zum Entprellen), Empfänger und Betreff, nie der
 * Text. Nur ergänzen, mit Audit-Log.
 */
export const benachrichtigungen = pgTable(
  "benachrichtigungen",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    anlass: text("anlass").notNull(),
    zustand: text("zustand").notNull(),
    empfaenger: text("empfaenger").array().notNull(),
    betreff: text("betreff").notNull(),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }).notNull().defaultNow(),
    ok: boolean("ok").notNull(),
    fehler: text("fehler"),
  },
  (t) => [
    index("benachrichtigungen_anlass").on(t.anlass, t.zustand, t.gesendetAm),
    check("benachrichtigungen_fehler", sql`${t.ok} = (${t.fehler} is null)`),
  ],
);
