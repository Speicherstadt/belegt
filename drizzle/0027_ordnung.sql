CREATE TABLE "dokument_dokumenttypen" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"dokumenttyp_id" uuid NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokument_dokumenttypen_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "dokument_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokument_tags_eindeutig" UNIQUE("dokument_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "dokumenttypen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vorgabe_art" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokumenttypen_name" CHECK (length(trim("dokumenttypen"."name")) between 1 and 100),
	CONSTRAINT "dokumenttypen_vorgabe_art" CHECK ("dokumenttypen"."vorgabe_art" is null or "dokumenttypen"."vorgabe_art" in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei'))
);
--> statement-breakpoint
CREATE TABLE "felder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"typ" text NOT NULL,
	"optionen" text[] DEFAULT '{}'::text[] NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "felder_name" CHECK (length(trim("felder"."name")) between 1 and 100),
	CONSTRAINT "felder_typ" CHECK ("felder"."typ" in ('text', 'zahl', 'betrag', 'datum', 'ja_nein', 'auswahl', 'link')),
	CONSTRAINT "felder_optionen" CHECK (("felder"."typ" = 'auswahl') = (cardinality("felder"."optionen") > 0))
);
--> statement-breakpoint
CREATE TABLE "feldwerte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"feld_id" uuid NOT NULL,
	"wert_text" text,
	"wert_zahl" bigint,
	"wert_datum" date,
	"wert_bool" boolean,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feldwerte_eindeutig" UNIQUE("dokument_id","feld_id"),
	CONSTRAINT "feldwerte_ein_wert" CHECK (num_nonnulls("feldwerte"."wert_text", "feldwerte"."wert_zahl", "feldwerte"."wert_datum", "feldwerte"."wert_bool") = 1)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"farbe" text DEFAULT 'grau' NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name" CHECK (length(trim("tags"."name")) between 1 and 100),
	CONSTRAINT "tags_farbe" CHECK ("tags"."farbe" in ('grau', 'rot', 'orange', 'gelb', 'gruen', 'tuerkis', 'blau', 'violett', 'rosa'))
);
--> statement-breakpoint
ALTER TABLE "dokument_dokumenttypen" ADD CONSTRAINT "dokument_dokumenttypen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument_dokumenttypen" ADD CONSTRAINT "dokument_dokumenttypen_dokumenttyp_id_dokumenttypen_id_fk" FOREIGN KEY ("dokumenttyp_id") REFERENCES "public"."dokumenttypen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument_tags" ADD CONSTRAINT "dokument_tags_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dokument_tags" ADD CONSTRAINT "dokument_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feldwerte" ADD CONSTRAINT "feldwerte_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feldwerte" ADD CONSTRAINT "feldwerte_feld_id_felder_id_fk" FOREIGN KEY ("feld_id") REFERENCES "public"."felder"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dokument_dokumenttypen_typ" ON "dokument_dokumenttypen" USING btree ("dokumenttyp_id");--> statement-breakpoint
CREATE INDEX "dokument_tags_tag" ON "dokument_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dokumenttypen_name_eindeutig" ON "dokumenttypen" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "felder_name_eindeutig" ON "felder" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "feldwerte_feld" ON "feldwerte" USING btree ("feld_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_eindeutig" ON "tags" USING btree (lower("name"));--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Metadaten, kein Original: änderbar, aber jede Änderung mit Akteur im Audit-Log
SELECT belegt_audit_table('tags');--> statement-breakpoint
SELECT belegt_audit_table('dokument_tags');--> statement-breakpoint
SELECT belegt_audit_table('dokumenttypen');--> statement-breakpoint
SELECT belegt_audit_table('dokument_dokumenttypen');--> statement-breakpoint
SELECT belegt_audit_table('felder');--> statement-breakpoint
SELECT belegt_audit_table('feldwerte');--> statement-breakpoint
-- Ein gelöschtes Dokument bekommt keine neuen Metadaten; vorhandene bleiben und lassen sich nur entfernen
CREATE TRIGGER dokument_tags_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON dokument_tags FOR EACH ROW
  EXECUTE FUNCTION belegt_nicht_nach_loeschung();--> statement-breakpoint
CREATE TRIGGER dokument_dokumenttypen_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON dokument_dokumenttypen FOR EACH ROW
  EXECUTE FUNCTION belegt_nicht_nach_loeschung();--> statement-breakpoint
CREATE TRIGGER feldwerte_nicht_nach_loeschung BEFORE INSERT OR UPDATE ON feldwerte FOR EACH ROW
  EXECUTE FUNCTION belegt_nicht_nach_loeschung();--> statement-breakpoint
-- Ein Feld behält seinen Typ, sonst passten die gespeicherten Werte nicht mehr
CREATE FUNCTION belegt_feldtyp_fest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.typ IS DISTINCT FROM OLD.typ THEN
    RAISE EXCEPTION 'Der Typ eines Feldes lässt sich nicht ändern' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER felder_typ_fest BEFORE UPDATE ON felder FOR EACH ROW EXECUTE FUNCTION belegt_feldtyp_fest();--> statement-breakpoint
-- Volltext auch aus Tags, Dokumenttyp und den Textwerten eigener Felder. Der gelesene Inhalt bleibt wie bisher nach
-- der Löschung draußen (belegt_inhalt_loeschen); die Metadaten bleiben als Teil des Löschnachweises.
CREATE OR REPLACE FUNCTION belegt_suchtext(did uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO suchtexte (dokument_id, text)
  SELECT d.id, concat_ws(' ', d.dateiname, e.titel, e.korrespondent, m.von, m.betreff, m.text, pm.von, pm.betreff,
                         i.erechnung ->> 'nummer', i.erechnung ->> 'verkaeufer', i.text,
                         (SELECT string_agg(t.name, ' ') FROM dokument_tags dt JOIN tags t ON t.id = dt.tag_id
                           WHERE dt.dokument_id = d.id),
                         (SELECT ty.name FROM dokument_dokumenttypen dd JOIN dokumenttypen ty ON ty.id = dd.dokumenttyp_id
                           WHERE dd.dokument_id = d.id),
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
CREATE FUNCTION belegt_suchtext_ordnung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'tags' THEN
      PERFORM belegt_suchtext(dt.dokument_id) FROM dokument_tags dt WHERE dt.tag_id = NEW.id;
    WHEN 'dokumenttypen' THEN
      PERFORM belegt_suchtext(dd.dokument_id) FROM dokument_dokumenttypen dd WHERE dd.dokumenttyp_id = NEW.id;
    ELSE
      PERFORM belegt_suchtext(CASE WHEN TG_OP = 'DELETE' THEN OLD.dokument_id ELSE NEW.dokument_id END);
  END CASE;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tags_suchtext AFTER UPDATE OF name ON tags FOR EACH ROW EXECUTE FUNCTION belegt_suchtext_ordnung();--> statement-breakpoint
CREATE TRIGGER dokumenttypen_suchtext AFTER UPDATE OF name ON dokumenttypen FOR EACH ROW
  EXECUTE FUNCTION belegt_suchtext_ordnung();--> statement-breakpoint
CREATE TRIGGER dokument_tags_suchtext AFTER INSERT OR DELETE ON dokument_tags FOR EACH ROW
  EXECUTE FUNCTION belegt_suchtext_ordnung();--> statement-breakpoint
CREATE TRIGGER dokument_dokumenttypen_suchtext AFTER INSERT OR UPDATE OR DELETE ON dokument_dokumenttypen FOR EACH ROW
  EXECUTE FUNCTION belegt_suchtext_ordnung();--> statement-breakpoint
CREATE TRIGGER feldwerte_suchtext AFTER INSERT OR UPDATE OR DELETE ON feldwerte FOR EACH ROW
  EXECUTE FUNCTION belegt_suchtext_ordnung();
