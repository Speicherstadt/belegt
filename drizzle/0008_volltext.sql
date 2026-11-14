-- Volltext: abgeleitet aus Dateiname, Einordnung (Titel, Korrespondent) und Mail (Absender, Betreff, Text; bei einem
-- Anhang die seiner Mail). Kein GoBD-Bestand, jederzeit neu erzeugbar, deshalb ohne Audit-Log und ohne Siegel.
CREATE TABLE suchtexte (
  dokument_id uuid PRIMARY KEY REFERENCES dokumente(id),
  text text NOT NULL,
  vektor tsvector GENERATED ALWAYS AS (to_tsvector('german', text)) STORED
);--> statement-breakpoint
CREATE INDEX suchtexte_vektor ON suchtexte USING gin (vektor);--> statement-breakpoint
CREATE FUNCTION belegt_suchtext(did uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO suchtexte (dokument_id, text)
  SELECT d.id, concat_ws(' ', d.dateiname, e.titel, e.korrespondent, m.von, m.betreff, m.text, pm.von, pm.betreff)
    FROM dokumente d
    LEFT JOIN LATERAL (SELECT * FROM einordnungen x WHERE x.dokument_id = d.id ORDER BY x.erstellt_am DESC, x.id DESC LIMIT 1) e ON true
    LEFT JOIN mails m ON m.dokument_id = d.id
    LEFT JOIN mail_anhaenge a ON a.anhang_dokument_id = d.id
    LEFT JOIN mails pm ON pm.dokument_id = a.mail_dokument_id
   WHERE d.id = did
  ON CONFLICT (dokument_id) DO UPDATE SET text = excluded.text
$$;--> statement-breakpoint
CREATE FUNCTION belegt_suchtext_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'dokumente' THEN PERFORM belegt_suchtext(NEW.id);
    WHEN 'einordnungen' THEN PERFORM belegt_suchtext(NEW.dokument_id);
    WHEN 'mails' THEN PERFORM belegt_suchtext(NEW.dokument_id);
    WHEN 'mail_anhaenge' THEN PERFORM belegt_suchtext(NEW.anhang_dokument_id);
  END CASE;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dokumente_suchtext AFTER INSERT ON dokumente FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_trigger();--> statement-breakpoint
CREATE TRIGGER einordnungen_suchtext AFTER INSERT ON einordnungen FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_trigger();--> statement-breakpoint
CREATE TRIGGER mails_suchtext AFTER INSERT ON mails FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_trigger();--> statement-breakpoint
CREATE TRIGGER mail_anhaenge_suchtext AFTER INSERT ON mail_anhaenge FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_trigger();--> statement-breakpoint
SELECT belegt_suchtext(id) FROM dokumente;
