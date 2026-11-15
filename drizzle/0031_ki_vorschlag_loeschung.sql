-- Der Vorschlag des Sprachmodells ist wie Text und Ansicht aus dem Inhalt abgeleitet (Titel, Korrespondent, Begründung):
-- Mit der bestätigten Löschung geht er mit. Die Sperre je Dokument aus 0025 ordnet Löschung und Worker weiterhin.
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ki_vorschlaege WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Fragt der Worker gerade das Modell, während die Löschung bestätigt wird, kommt sein Vorschlag nicht mehr hinein
CREATE TRIGGER ki_vorschlaege_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON ki_vorschlaege FOR EACH ROW
  EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();--> statement-breakpoint
-- Vorschläge, die eine Löschung vor dieser Migration überlebt haben
DELETE FROM ki_vorschlaege k
 WHERE EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = k.dokument_id AND l.bestaetigt_am IS NOT NULL);
