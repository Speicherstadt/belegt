import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
