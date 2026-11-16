import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { dokumente } from "./schema.ts";

/*
 * Doppelte Dateien (server/dokumente/doppelt.ts): Ein Anhang einer Mail, der schon als Dokument im Archiv liegt, wird
 * kein zweites Dokument; die Mail verweist auf das vorhandene. Die Datei steckt ohnehin in der .eml der Mail.
 */

/** Anhang einer Mail, der auf ein schon vorhandenes Dokument verweist; versiegelt wie mail_anhaenge */
export const mailVerweise = pgTable(
  "mail_verweise",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailDokumentId: uuid("mail_dokument_id")
      .notNull()
      .references(() => dokumente.id),
    dokumentId: uuid("dokument_id")
      .notNull()
      .references(() => dokumente.id),
    /** Name des Anhangs in dieser Mail; das vorhandene Dokument kann anders heißen */
    dateiname: text("dateiname"),
    eingebettet: boolean("eingebettet").notNull(),
  },
  (t) => [index("mail_verweise_mail").on(t.mailDokumentId), index("mail_verweise_dokument").on(t.dokumentId)],
);
