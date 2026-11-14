-- Löschung und Worker nebenläufig: Ohne Sperre prüft der Worker beim Schreiben (READ COMMITTED), sieht die Löschung
-- noch nicht, und die Löschung sieht seine noch offenen Zeilen nicht; nach beiden Commits blieben Text und Ansicht.
-- Eine Sperre je Dokument bis zum Ende der Transaktion ordnet beide; die Abfrage danach sieht dann, was festgeschrieben ist.
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION belegt_inhalt_nicht_nach_loeschung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  IF EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = NEW.dokument_id AND l.bestaetigt_am IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
