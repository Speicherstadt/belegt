import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { dokumente, workflows } from "./schema.ts";

/*
 * Workflow-Aktion „Original an Adresse senden“ (server/weitergabe/, docs/workflows.md#original-an-adresse-senden).
 */

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/**
 * Der Wert der Kopfzeile für die Anmeldung je Aktion eines Workflows, verschlüsselt mit BELEGT_SCHLUESSEL. Getrennt von
 * workflows.aktionen, damit er nie in der Antwort der Schnittstelle oder im Audit-Log steht (ciphertext ist dort
 * ausgenommen); geht mit dem Workflow.
 */
export const workflowGeheimnisse = pgTable(
  "workflow_geheimnisse",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    /** Stelle der Aktion in workflows.aktionen, ab 0 */
    position: smallint("position").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
  },
  (t) => [unique("workflow_geheimnisse_einmal").on(t.workflowId, t.position)],
);

/**
 * Eine ausstehende oder erledigte Weitergabe: je Dokument, Workflow und Aktion eine Zeile, also höchstens ein
 * erfolgreicher Versand. Der Worker sendet und schreibt das Ergebnis fort; im Audit-Log.
 */
export const weitergaben = pgTable(
  "weitergaben",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    position: smallint("position").notNull(),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    /** offen, gesendet, fehlgeschlagen (aufgegeben) oder entfallen (Dokument gelöscht, Workflow gelöscht) */
    stand: text("stand").notNull().default("offen"),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuch: timestamp("naechster_versuch", { withTimezone: true }).notNull().defaultNow(),
    letzterVersuch: timestamp("letzter_versuch", { withTimezone: true }),
    /** HTTP-Status der letzten Antwort, null ohne Antwort */
    httpStatus: integer("http_status"),
    fehler: text("fehler"),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("weitergaben_einmal").on(t.workflowId, t.position, t.dokumentId),
    index("weitergaben_faellig").on(t.stand, t.naechsterVersuch),
    index("weitergaben_dokument").on(t.dokumentId),
    check("weitergaben_stand", sql`${t.stand} in ('offen', 'gesendet', 'fehlgeschlagen', 'entfallen')`),
    check("weitergaben_gesendet", sql`(${t.stand} = 'gesendet') = (${t.gesendetAm} is not null)`),
  ],
);
