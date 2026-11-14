CREATE TABLE "loeschungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"beantragt_von" text NOT NULL,
	"beantragt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"bestaetigt_von" text,
	"bestaetigt_am" timestamp with time zone,
	CONSTRAINT "loeschungen_dokument_id_unique" UNIQUE("dokument_id"),
	CONSTRAINT "loeschungen_bestaetigung" CHECK (("loeschungen"."bestaetigt_von" is null) = ("loeschungen"."bestaetigt_am" is null))
);
--> statement-breakpoint
ALTER TABLE "loeschungen" ADD CONSTRAINT "loeschungen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Antrag änderbar und zurückziehbar, ab bestaetigt_am fest und versiegelt
SELECT belegt_seal_table('loeschungen', 'bestaetigt_am');--> statement-breakpoint
-- Ob gelöscht werden darf, entscheidet die Datenbank, nicht der App-Code: neueste Einordnung frei oder Frist
-- abgelaufen (Tag in Deutschland), keine offene Sperre über den Tag der Entstehung, und bestätigen muss jemand
-- anderes als der Antragsteller, außer bei freier Ablage. § 147 Abs. 3 Satz 5 AO (Ablaufhemmung) kann die Datenbank
-- nicht kennen; dafür steht die Bestätigung durch einen Menschen.
CREATE FUNCTION belegt_loeschung_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e einordnungen;
  heute date := (now() AT TIME ZONE 'Europe/Berlin')::date;
BEGIN
  SELECT * INTO e FROM einordnungen WHERE dokument_id = NEW.dokument_id ORDER BY erstellt_am DESC, id DESC LIMIT 1;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'Das Dokument ist nicht eingeordnet und hat keine Frist' USING ERRCODE = 'check_violation';
  END IF;
  IF e.art <> 'frei' AND e.frist_bis >= heute THEN
    RAISE EXCEPTION 'Die Frist läuft noch bis %', e.frist_bis USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM sperren s WHERE s.aufgehoben_am IS NULL AND e.entstanden BETWEEN s.von AND s.bis) THEN
    RAISE EXCEPTION 'Das Dokument liegt unter einer Sperre' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.bestaetigt_am IS NOT NULL AND e.art <> 'frei' AND NEW.bestaetigt_von = NEW.beantragt_von THEN
    RAISE EXCEPTION 'Die Löschung bestätigt eine zweite Person' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER loeschungen_pruefen BEFORE INSERT OR UPDATE ON loeschungen FOR EACH ROW EXECUTE FUNCTION belegt_loeschung_pruefen();--> statement-breakpoint
-- Nach der Bestätigung keine neue Einordnung mehr: Sie könnte die Frist im Nachhinein ändern
CREATE FUNCTION belegt_nicht_nach_loeschung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = NEW.dokument_id AND l.bestaetigt_am IS NOT NULL) THEN
    RAISE EXCEPTION 'Das Dokument ist gelöscht' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER einordnungen_nicht_nach_loeschung BEFORE INSERT ON einordnungen FOR EACH ROW EXECUTE FUNCTION belegt_nicht_nach_loeschung();
