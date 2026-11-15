CREATE TABLE "klassifikator" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"modell" jsonb NOT NULL,
	"beispiele" integer NOT NULL,
	"stand" text NOT NULL,
	"loeschungen" bigint NOT NULL,
	"trainiert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "klassifikator_eine_zeile" CHECK ("klassifikator"."id" = 1)
);
--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Das gelernte Modell enthält Wörter aus Inhalten. Mit jeder bestätigten Löschung geht es ganz (der Worker lernt ohne
-- das Dokument neu). Die Sperre belegt_klassifikator ordnet Löschung und Training: Ein Modell aus Beispielen, die vor
-- einer Löschung gelesen wurden, kommt danach nicht mehr hinein.
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
  DELETE FROM notiz_widerrufe w USING notizen n WHERE w.notiz_id = n.id AND n.dokument_id = NEW.dokument_id;
  DELETE FROM notizen WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Ein Modell gilt nur, wenn seit dem Lesen seiner Beispiele keine Löschung bestätigt wurde; sonst verwirft Postgres es
CREATE FUNCTION belegt_klassifikator_aktuell() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_klassifikator', 0));
  IF NEW.loeschungen <> (SELECT count(*) FROM loeschungen WHERE bestaetigt_am IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER klassifikator_aktuell BEFORE INSERT OR UPDATE ON klassifikator FOR EACH ROW
  EXECUTE FUNCTION belegt_klassifikator_aktuell();
