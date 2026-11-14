CREATE TABLE "ansichten" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"pdf" "bytea",
	"fehler" text,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ansichten" ADD CONSTRAINT "ansichten_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Die Ansicht ist wie der gelesene Inhalt eine Abschrift der Datei: Mit der bestätigten Löschung geht sie mit
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Erzeugt der Worker eine Ansicht, während die Löschung bestätigt wird, kommt sie nicht mehr hinein
CREATE TRIGGER ansichten_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON ansichten FOR EACH ROW
  EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();
