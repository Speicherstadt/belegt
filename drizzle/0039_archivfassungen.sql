CREATE TABLE "archivfassungen" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"pdf" "bytea",
	"seiten" integer,
	"fehler" text,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archivfassungen" ADD CONSTRAINT "archivfassungen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Die Archivfassung ist wie die Ansicht eine Abschrift der Datei: Mit der bestätigten Löschung geht sie mit. Die Sperre
-- je Dokument aus 0025 ordnet Löschung und Worker weiterhin.
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  DELETE FROM archivfassungen WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ki_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM vorschaubilder WHERE dokument_id = NEW.dokument_id;
  DELETE FROM notiz_widerrufe w USING notizen n WHERE w.notiz_id = n.id AND n.dokument_id = NEW.dokument_id;
  DELETE FROM notizen WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Erzeugt der Worker eine Archivfassung, während die Löschung bestätigt wird, kommt sie nicht mehr hinein
CREATE TRIGGER archivfassungen_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON archivfassungen FOR EACH ROW
  EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();
