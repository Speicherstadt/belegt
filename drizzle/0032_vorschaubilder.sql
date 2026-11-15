CREATE TABLE "vorschaubilder" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"bild" "bytea",
	"fehler" text,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vorschaubilder" ADD CONSTRAINT "vorschaubilder_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Das Vorschaubild ist wie die Ansicht eine Abschrift der Datei: Mit der bestätigten Löschung geht es mit. Die Sperre
-- je Dokument aus 0025 ordnet Löschung und Worker weiterhin.
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ki_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM vorschaubilder WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Erzeugt der Worker ein Vorschaubild, während die Löschung bestätigt wird, kommt es nicht mehr hinein
CREATE TRIGGER vorschaubilder_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON vorschaubilder FOR EACH ROW
  EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();
