CREATE TABLE "notiz_widerrufe" (
	"notiz_id" uuid PRIMARY KEY NOT NULL,
	"widerrufen_von" text NOT NULL,
	"widerrufen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notizen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"text" text NOT NULL,
	"text_sha256" text DEFAULT '' NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notizen_text" CHECK (length(trim("notizen"."text")) between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "notiz_widerrufe" ADD CONSTRAINT "notiz_widerrufe_notiz_id_notizen_id_fk" FOREIGN KEY ("notiz_id") REFERENCES "public"."notizen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notizen" ADD CONSTRAINT "notizen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notizen_dokument" ON "notizen" USING btree ("dokument_id","erstellt_am");--> statement-breakpoint
CREATE INDEX "notizen_volltext" ON "notizen" USING gin (to_tsvector('german', "text"));--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Notizen stehen im Audit-Log ohne ihren Text: Er geht mit der Löschung des Dokuments, das Audit-Log nie. Der SHA-256
-- des Texts bleibt dort als Nachweis, was stand.
SELECT belegt_audit_table('notizen', 'text');--> statement-breakpoint
SELECT belegt_audit_table('notiz_widerrufe');--> statement-breakpoint
CREATE FUNCTION belegt_notiz_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.text_sha256 := encode(sha256(convert_to(NEW.text, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER notizen_hash BEFORE INSERT ON notizen FOR EACH ROW EXECUTE FUNCTION belegt_notiz_hash();--> statement-breakpoint
-- Nur ergänzen: Ändern nie, Löschen nur, wenn die Löschung des Dokuments bestätigt ist (belegt_inhalt_loeschen)
CREATE FUNCTION belegt_notiz_nur_ergaenzen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  did uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'notizen' THEN
      did := OLD.dokument_id;
    ELSE
      SELECT n.dokument_id INTO did FROM notizen n WHERE n.id = OLD.notiz_id;
    END IF;
    IF EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = did AND l.bestaetigt_am IS NOT NULL) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% darf nur ergänzt werden', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER notizen_nur_ergaenzen BEFORE UPDATE OR DELETE ON notizen FOR EACH ROW
  EXECUTE FUNCTION belegt_notiz_nur_ergaenzen();--> statement-breakpoint
CREATE TRIGGER notiz_widerrufe_nur_ergaenzen BEFORE UPDATE OR DELETE ON notiz_widerrufe FOR EACH ROW
  EXECUTE FUNCTION belegt_notiz_nur_ergaenzen();--> statement-breakpoint
-- Eine neue Notiz an einem gelöschten Dokument lehnt Postgres ab; die Sperre je Dokument aus 0025 ordnet sie gegen
-- eine gleichzeitige Löschung, damit keine Notiz die Löschung überlebt
CREATE FUNCTION belegt_notiz_nicht_nach_loeschung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  IF EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = NEW.dokument_id AND l.bestaetigt_am IS NOT NULL) THEN
    RAISE EXCEPTION 'Das Dokument ist gelöscht' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER notizen_nicht_nach_loeschung BEFORE INSERT ON notizen FOR EACH ROW
  EXECUTE FUNCTION belegt_notiz_nicht_nach_loeschung();--> statement-breakpoint
-- Notizen sind Anmerkungen, keine Unterlage: Mit der bestätigten Löschung gehen sie mit ihren Widerrufen mit
CREATE OR REPLACE FUNCTION belegt_inhalt_loeschen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  DELETE FROM inhalte WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ansichten WHERE dokument_id = NEW.dokument_id;
  DELETE FROM ki_vorschlaege WHERE dokument_id = NEW.dokument_id;
  DELETE FROM vorschaubilder WHERE dokument_id = NEW.dokument_id;
  DELETE FROM notiz_widerrufe w USING notizen n WHERE w.notiz_id = n.id AND n.dokument_id = NEW.dokument_id;
  DELETE FROM notizen WHERE dokument_id = NEW.dokument_id;
  PERFORM belegt_suchtext(NEW.dokument_id);
  RETURN NULL;
END;
$$;
