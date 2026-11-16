CREATE TABLE "erechnung_pruefungen" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"gueltig" boolean NOT NULL,
	"szenario" text,
	"fehler" integer NOT NULL,
	"warnungen" integer NOT NULL,
	"meldungen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"geprueft_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erechnung_pruefungen_meldungen" CHECK (jsonb_typeof("erechnung_pruefungen"."meldungen") = 'array')
);
--> statement-breakpoint
ALTER TABLE "erechnung_pruefungen" ADD CONSTRAINT "erechnung_pruefungen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Die Prüfung einer E-Rechnung ist abgeleitet wie Text und Ansicht: Mit der bestätigten Löschung geht sie mit
-- (wie in 0041, dazu erechnung_pruefungen), und ein Worker, der gerade prüft, bringt sie nicht zurück
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_klassifikator', 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  DELETE FROM archivfassungen WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ki_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM zuordnung_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM klassifikator;
  DELETE FROM vorschaubilder WHERE dokument_id = NEW.dokument_id;
  DELETE FROM erechnung_pruefungen WHERE dokument_id = NEW.dokument_id;
  DELETE FROM notiz_widerrufe w USING notizen n WHERE w.notiz_id = n.id AND n.dokument_id = NEW.dokument_id;
  DELETE FROM notizen WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER erechnung_pruefungen_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON erechnung_pruefungen FOR EACH ROW
  EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();
