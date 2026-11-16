import { aufruf } from "./api-aufruf.ts";

/* Stand des Betriebs (GET /api/betrieb): wirksame Rechte der Datenbankanmeldung und Stand der Sicherung (docs/betrieb.md) */

export type DatenbankProblem =
  | "rollenwechsel"
  | "replika"
  | "admin"
  | "eigentuemer"
  | "anlegen"
  | "temporaer"
  | "replikation"
  | "dateien"
  | "leeren";

export interface TabellenRechte {
  tabelle: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  trigger: boolean;
}

export interface Datenbankzugriff {
  rolle: string;
  anmeldung: string;
  eingeschraenkt: boolean;
  probleme: DatenbankProblem[];
  tabellen: TabellenRechte[];
}

export interface BackupLauf {
  am: string;
  ok: boolean;
  snapshot: string | null;
  bytes: number | null;
  meldung: string;
  ziel: string | null;
  zeitplan: string | null;
}

/** Stand der Sicherung aus dem Backup-Container (server/betrieb/backup.ts) */
export interface BackupStand {
  zustand: "keins" | "ok" | "veraltet" | "fehler";
  ueberfaellig: boolean;
  letztesBackup: BackupLauf | null;
  letzterTest: BackupLauf | null;
  fehlgeschlagen: { art: "backup" | "restore_check"; lauf: BackupLauf }[];
}

export interface Betriebsstand {
  datenbank: Datenbankzugriff;
  backup: BackupStand;
}

export const standApi = {
  betrieb: () => aufruf<Betriebsstand>("/api/betrieb"),
};
