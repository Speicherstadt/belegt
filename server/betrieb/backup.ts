import { and, desc, eq } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { backupStatus } from "../db/schema.ts";

/*
 * Stand der Sicherung aus backup_status, die der Backup-Container (deploy/backup) nach jedem Lauf schreibt: Backup und
 * Test-Restore. Die App liest nur.
 */

export type BackupArt = "backup" | "restore_check";

export interface BackupLauf {
  am: string;
  ok: boolean;
  snapshot: string | null;
  bytes: number | null;
  meldung: string;
  ziel: string | null;
  zeitplan: string | null;
}

export interface BackupStand {
  /** keins: noch nie ein Lauf; fehler: der letzte Lauf einer Art schlug fehl; veraltet: kein Backup seit zwei Tagen */
  zustand: "keins" | "ok" | "veraltet" | "fehler";
  /** Kein erfolgreiches Backup seit zwei Tagen, auch wenn der Zustand wegen eines Fehlschlags „fehler“ ist */
  ueberfaellig: boolean;
  letztesBackup: BackupLauf | null;
  letzterTest: BackupLauf | null;
  /** Der letzte Lauf je Art, wenn er fehlschlug */
  fehlgeschlagen: { art: BackupArt; lauf: BackupLauf }[];
}

/** Ein Backup am Tag; ein ausgefallener Lauf ist noch kein Grund zur Warnung */
export const BACKUP_HOECHSTALTER_MS = 2 * 24 * 60 * 60 * 1000;

const ARTEN: BackupArt[] = ["backup", "restore_check"];

async function letzter(db: Datenbank, art: BackupArt, ok?: boolean): Promise<BackupLauf | null> {
  const t = backupStatus;
  const [z] = await db
    .select({
      am: t.am,
      ok: t.ok,
      snapshot: t.snapshot,
      bytes: t.bytes,
      meldung: t.meldung,
      ziel: t.ziel,
      zeitplan: t.zeitplan,
    })
    .from(t)
    .where(ok === undefined ? eq(t.art, art) : and(eq(t.art, art), eq(t.ok, ok)))
    .orderBy(desc(t.am), desc(t.id))
    .limit(1);
  return z ? { ...z, am: z.am.toISOString() } : null;
}

export async function backupStand(db: Datenbank, jetzt = new Date()): Promise<BackupStand> {
  const [letztesBackup, letzterTest, ...letzte] = await Promise.all([
    letzter(db, "backup", true),
    letzter(db, "restore_check", true),
    ...ARTEN.map((art) => letzter(db, art)),
  ]);
  const fehlgeschlagen = ARTEN.flatMap((art, i) => {
    const lauf = letzte[i];
    return lauf && !lauf.ok ? [{ art, lauf }] : [];
  });
  const keins = letzte.every((l) => !l);
  const ueberfaellig =
    !keins && (!letztesBackup || jetzt.getTime() - new Date(letztesBackup.am).getTime() > BACKUP_HOECHSTALTER_MS);
  const zustand = keins ? "keins" : fehlgeschlagen.length ? "fehler" : ueberfaellig ? "veraltet" : "ok";
  return {
    zustand,
    ueberfaellig,
    letztesBackup: letztesBackup ?? null,
    letzterTest: letzterTest ?? null,
    fehlgeschlagen,
  };
}
