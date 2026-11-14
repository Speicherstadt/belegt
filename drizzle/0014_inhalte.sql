CREATE TABLE "inhalte" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"erechnung" jsonb,
	"fehler" text,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inhalte" ADD CONSTRAINT "inhalte_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Volltext auch aus dem gelesenen Inhalt (PDF-Text, Nummer und Verkäufer einer E-Rechnung)
CREATE OR REPLACE FUNCTION belegt_suchtext(did uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO suchtexte (dokument_id, text)
  SELECT d.id, concat_ws(' ', d.dateiname, e.titel, e.korrespondent, m.von, m.betreff, m.text, pm.von, pm.betreff,
                         i.erechnung ->> 'nummer', i.erechnung ->> 'verkaeufer', i.text)
    FROM dokumente d
    LEFT JOIN LATERAL (SELECT * FROM einordnungen x WHERE x.dokument_id = d.id ORDER BY x.erstellt_am DESC, x.id DESC LIMIT 1) e ON true
    LEFT JOIN mails m ON m.dokument_id = d.id
    LEFT JOIN mail_anhaenge a ON a.anhang_dokument_id = d.id
    LEFT JOIN mails pm ON pm.dokument_id = a.mail_dokument_id
    LEFT JOIN inhalte i ON i.dokument_id = d.id
   WHERE d.id = did
  ON CONFLICT (dokument_id) DO UPDATE SET text = excluded.text
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION belegt_suchtext_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'dokumente' THEN PERFORM belegt_suchtext(NEW.id);
    WHEN 'einordnungen' THEN PERFORM belegt_suchtext(NEW.dokument_id);
    WHEN 'mails' THEN PERFORM belegt_suchtext(NEW.dokument_id);
    WHEN 'mail_anhaenge' THEN PERFORM belegt_suchtext(NEW.anhang_dokument_id);
    WHEN 'inhalte' THEN PERFORM belegt_suchtext(NEW.dokument_id);
  END CASE;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER inhalte_suchtext AFTER INSERT OR UPDATE ON inhalte FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_trigger();
