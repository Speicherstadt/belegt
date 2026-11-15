import { customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/**
 * Durchsuchbares PDF (PDF/A-2b) für Scans: jede Seite als Bild mit dem erkannten Text unsichtbar darüber, erzeugt im
 * Worker mit Tesseract (server/archivfassung/). Abgeleitet wie ansichten: weder versiegelt noch im Audit-Log, das
 * Original bleibt maßgeblich und unverändert; mit der bestätigten Löschung weg (belegt_inhalt_loeschen). Ein Fehler
 * steht in fehler, damit dieselbe Datei nicht in jedem Lauf wieder scheitert.
 */
export const archivfassungen = pgTable("archivfassungen", {
  dokumentId: uuid("dokument_id")
    .primaryKey()
    .references(() => dokumente.id),
  pdf: bytea("pdf"),
  seiten: integer("seiten"),
  fehler: text("fehler"),
  erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
});
