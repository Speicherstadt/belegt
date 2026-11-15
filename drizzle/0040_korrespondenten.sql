CREATE TABLE "dokument_korrespondenten" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"korrespondent_id" uuid NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokument_korrespondenten_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "korrespondenten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abgleich" text DEFAULT 'automatisch' NOT NULL,
	"abgleich_text" text DEFAULT '' NOT NULL,
	"gross_klein_egal" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "korrespondenten_name" CHECK (length(trim("korrespondenten"."name")) between 1 and 300),
	CONSTRAINT "korrespondenten_abgleich" CHECK ("korrespondenten"."abgleich" in ('keiner', 'irgendein_wort', 'alle_woerter', 'exakt', 'regex', 'unscharf', 'automatisch')),
	CONSTRAINT "korrespondenten_abgleich_text" CHECK (length("korrespondenten"."abgleich_text") <= 500)
);
--> statement-breakpoint
CREATE TABLE "zuordnung_vorschlaege" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"vorschlag" jsonb NOT NULL,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regeln" DROP CONSTRAINT "regeln_art_oder_ordnung";--> statement-breakpoint
ALTER TABLE "dokumenttypen" ADD COLUMN "abgleich" text DEFAULT 'automatisch' NOT NULL;--> statement-breakpoint
ALTER TABLE "dokumenttypen" ADD COLUMN "abgleich_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dokumenttypen" ADD COLUMN "gross_klein_egal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "abgleich" text DEFAULT 'automatisch' NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "abgleich_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "gross_klein_egal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dokument_korrespondenten" ADD CONSTRAINT "dokument_korrespondenten_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument_korrespondenten" ADD CONSTRAINT "dokument_korrespondenten_korrespondent_id_korrespondenten_id_fk" FOREIGN KEY ("korrespondent_id") REFERENCES "public"."korrespondenten"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zuordnung_vorschlaege" ADD CONSTRAINT "zuordnung_vorschlaege_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dokument_korrespondenten_korrespondent" ON "dokument_korrespondenten" USING btree ("korrespondent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "korrespondenten_name_eindeutig" ON "korrespondenten" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "dokumenttypen" ADD CONSTRAINT "dokumenttypen_abgleich" CHECK ("dokumenttypen"."abgleich" in ('keiner', 'irgendein_wort', 'alle_woerter', 'exakt', 'regex', 'unscharf', 'automatisch'));--> statement-breakpoint
ALTER TABLE "dokumenttypen" ADD CONSTRAINT "dokumenttypen_abgleich_text" CHECK (length("dokumenttypen"."abgleich_text") <= 500);--> statement-breakpoint
ALTER TABLE "regeln" ADD CONSTRAINT "regeln_art_oder_ordnung" CHECK ("regeln"."art" is not null
          or coalesce("regeln"."ordnung" -> 'tags', '[]'::jsonb) <> '[]'::jsonb
          or coalesce("regeln"."ordnung" -> 'dokumenttyp', 'null'::jsonb) <> 'null'::jsonb
          or coalesce("regeln"."ordnung" -> 'korrespondent', 'null'::jsonb) <> 'null'::jsonb
          or coalesce("regeln"."ordnung" -> 'felder', '[]'::jsonb) <> '[]'::jsonb);--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_abgleich" CHECK ("tags"."abgleich" in ('keiner', 'irgendein_wort', 'alle_woerter', 'exakt', 'regex', 'unscharf', 'automatisch'));--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_abgleich_text" CHECK (length("tags"."abgleich_text") <= 500);--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Metadaten, kein Original: änderbar, aber jede Änderung mit Akteur im Audit-Log
SELECT belegt_audit_table('korrespondenten');--> statement-breakpoint
SELECT belegt_audit_table('dokument_korrespondenten');--> statement-breakpoint
-- Ein gelöschtes Dokument bekommt keinen neuen Korrespondenten; der vorhandene bleibt als Teil des Löschnachweises
CREATE TRIGGER dokument_korrespondenten_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON dokument_korrespondenten
  FOR EACH ROW EXECUTE FUNCTION belegt_nicht_nach_loeschung();--> statement-breakpoint
-- Vorschläge der Zuordnungsregeln sind aus dem Inhalt abgeleitet: nach der Löschung keine neuen
CREATE TRIGGER zuordnung_vorschlaege_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON zuordnung_vorschlaege
  FOR EACH ROW EXECUTE FUNCTION belegt_inhalt_nicht_nach_loeschung();--> statement-breakpoint
-- Die Vorschläge der Zuordnungsregeln sind aus dem Inhalt abgeleitet und gehen mit der bestätigten Löschung
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  DELETE FROM archivfassungen WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ki_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM zuordnung_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM vorschaubilder WHERE dokument_id = NEW.dokument_id;
  DELETE FROM notiz_widerrufe w USING notizen n WHERE w.notiz_id = n.id AND n.dokument_id = NEW.dokument_id;
  DELETE FROM notizen WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Ändert sich eine Zuordnungsregel, wertet der Worker die Dokumente im Eingang neu aus
CREATE FUNCTION belegt_zuordnung_neu() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM zuordnung_vorschlaege z
   WHERE NOT EXISTS (SELECT 1 FROM einordnungen e WHERE e.dokument_id = z.dokument_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER korrespondenten_zuordnung_neu AFTER INSERT ON korrespondenten FOR EACH ROW
  WHEN (NEW.abgleich NOT IN ('keiner', 'automatisch')) EXECUTE FUNCTION belegt_zuordnung_neu();--> statement-breakpoint
CREATE TRIGGER korrespondenten_zuordnung_geaendert AFTER UPDATE OF abgleich, abgleich_text, gross_klein_egal ON korrespondenten FOR EACH ROW
  WHEN ((OLD.abgleich, OLD.abgleich_text, OLD.gross_klein_egal) IS DISTINCT FROM (NEW.abgleich, NEW.abgleich_text, NEW.gross_klein_egal))
  EXECUTE FUNCTION belegt_zuordnung_neu();--> statement-breakpoint
CREATE TRIGGER dokumenttypen_zuordnung_neu AFTER INSERT ON dokumenttypen FOR EACH ROW
  WHEN (NEW.abgleich NOT IN ('keiner', 'automatisch')) EXECUTE FUNCTION belegt_zuordnung_neu();--> statement-breakpoint
CREATE TRIGGER dokumenttypen_zuordnung_geaendert AFTER UPDATE OF abgleich, abgleich_text, gross_klein_egal ON dokumenttypen FOR EACH ROW
  WHEN ((OLD.abgleich, OLD.abgleich_text, OLD.gross_klein_egal) IS DISTINCT FROM (NEW.abgleich, NEW.abgleich_text, NEW.gross_klein_egal))
  EXECUTE FUNCTION belegt_zuordnung_neu();--> statement-breakpoint
CREATE TRIGGER tags_zuordnung_neu AFTER INSERT ON tags FOR EACH ROW
  WHEN (NEW.abgleich NOT IN ('keiner', 'automatisch')) EXECUTE FUNCTION belegt_zuordnung_neu();--> statement-breakpoint
CREATE TRIGGER tags_zuordnung_geaendert AFTER UPDATE OF abgleich, abgleich_text, gross_klein_egal ON tags FOR EACH ROW
  WHEN ((OLD.abgleich, OLD.abgleich_text, OLD.gross_klein_egal) IS DISTINCT FROM (NEW.abgleich, NEW.abgleich_text, NEW.gross_klein_egal))
  EXECUTE FUNCTION belegt_zuordnung_neu();--> statement-breakpoint
-- Volltext auch aus dem Namen des Korrespondenten in der Liste; der Text der Einordnung bleibt darin
CREATE OR REPLACE FUNCTION belegt_suchtext(did uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO suchtexte (dokument_id, text)
  SELECT d.id, concat_ws(' ', d.dateiname, e.titel, e.korrespondent, m.von, m.betreff, m.text, pm.von, pm.betreff,
                         i.erechnung ->> 'nummer', i.erechnung ->> 'verkaeufer', i.text,
                         (SELECT string_agg(t.name, ' ') FROM dokument_tags dt JOIN tags t ON t.id = dt.tag_id
                           WHERE dt.dokument_id = d.id),
                         (SELECT ty.name FROM dokument_dokumenttypen dd JOIN dokumenttypen ty ON ty.id = dd.dokumenttyp_id
                           WHERE dd.dokument_id = d.id),
                         (SELECT k.name FROM dokument_korrespondenten dk JOIN korrespondenten k ON k.id = dk.korrespondent_id
                           WHERE dk.dokument_id = d.id),
                         (SELECT string_agg(fw.wert_text, ' ') FROM feldwerte fw WHERE fw.dokument_id = d.id))
    FROM dokumente d
    LEFT JOIN LATERAL (SELECT * FROM einordnungen x WHERE x.dokument_id = d.id ORDER BY x.erstellt_am DESC, x.id DESC LIMIT 1) e ON true
    LEFT JOIN mails m ON m.dokument_id = d.id
    LEFT JOIN mail_anhaenge a ON a.anhang_dokument_id = d.id
    LEFT JOIN mails pm ON pm.dokument_id = a.mail_dokument_id
    LEFT JOIN inhalte i ON i.dokument_id = d.id
   WHERE d.id = did
  ON CONFLICT (dokument_id) DO UPDATE SET text = excluded.text
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION belegt_suchtext_ordnung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'tags' THEN
      PERFORM belegt_suchtext(dt.dokument_id) FROM dokument_tags dt WHERE dt.tag_id = NEW.id;
    WHEN 'dokumenttypen' THEN
      PERFORM belegt_suchtext(dd.dokument_id) FROM dokument_dokumenttypen dd WHERE dd.dokumenttyp_id = NEW.id;
    WHEN 'korrespondenten' THEN
      PERFORM belegt_suchtext(dk.dokument_id) FROM dokument_korrespondenten dk WHERE dk.korrespondent_id = NEW.id;
    ELSE
      PERFORM belegt_suchtext(CASE WHEN TG_OP = 'DELETE' THEN OLD.dokument_id ELSE NEW.dokument_id END);
  END CASE;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER korrespondenten_suchtext AFTER UPDATE OF name ON korrespondenten FOR EACH ROW
  EXECUTE FUNCTION belegt_suchtext_ordnung();--> statement-breakpoint
CREATE TRIGGER dokument_korrespondenten_suchtext AFTER INSERT OR UPDATE OR DELETE ON dokument_korrespondenten
  FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_ordnung();--> statement-breakpoint
-- Bisherige Freitexte werden Einträge der Liste: je Schreibweise ohne Groß- und Kleinschreibung einer, mit der
-- ältesten Schreibweise. Maßgeblich ist die neueste Einordnung jedes Dokuments, das nicht gelöscht ist. Die
-- versiegelten Einordnungen liest die Migration nur; ihr Text bleibt, wie er ist.
INSERT INTO korrespondenten (name)
SELECT DISTINCT ON (lower(trim(e.korrespondent))) trim(e.korrespondent)
  FROM dokumente d
  JOIN LATERAL (SELECT * FROM einordnungen x WHERE x.dokument_id = d.id
                 ORDER BY x.erstellt_am DESC, x.id DESC LIMIT 1) e ON true
 WHERE trim(coalesce(e.korrespondent, '')) <> ''
   AND NOT EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = d.id AND l.bestaetigt_am IS NOT NULL)
 ORDER BY lower(trim(e.korrespondent)), e.erstellt_am, e.id;--> statement-breakpoint
INSERT INTO dokument_korrespondenten (dokument_id, korrespondent_id)
SELECT d.id, k.id
  FROM dokumente d
  JOIN LATERAL (SELECT * FROM einordnungen x WHERE x.dokument_id = d.id
                 ORDER BY x.erstellt_am DESC, x.id DESC LIMIT 1) e ON true
  JOIN korrespondenten k ON lower(k.name) = lower(trim(e.korrespondent))
 WHERE NOT EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = d.id AND l.bestaetigt_am IS NOT NULL);
