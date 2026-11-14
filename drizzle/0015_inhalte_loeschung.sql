-- Der gelesene Inhalt ist eine Abschrift der Datei: Mit der bestätigten Löschung geht er mit der Datei, auch aus
-- dem Volltext. Die Zeile in dokumente bleibt als Löschnachweis.
CREATE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER loeschungen_inhalt AFTER INSERT OR UPDATE OF bestaetigt_am ON loeschungen FOR EACH ROW
  WHEN (NEW.bestaetigt_am IS NOT NULL) EXECUTE FUNCTION belegt_inhalt_loeschen();--> statement-breakpoint
-- Liest der Worker ein Dokument, während die Löschung bestätigt wird, kommt sein Inhalt nicht mehr hinein
CREATE FUNCTION belegt_inhalt_nicht_nach_loeschung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = NEW.dokument_id AND l.bestaetigt_am IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER inhalte_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON inhalte FOR EACH ROW
  EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();--> statement-breakpoint
-- Was schon vor dieser Migration gelöscht war
DELETE FROM inhalte i USING loeschungen l WHERE l.dokument_id = i.dokument_id AND l.bestaetigt_am IS NOT NULL;--> statement-breakpoint
SELECT belegt_suchtext(dokument_id) FROM loeschungen WHERE bestaetigt_am IS NOT NULL;
