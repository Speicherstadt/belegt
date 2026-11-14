CREATE TABLE "einordnungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"art" text NOT NULL,
	"entstanden" date NOT NULL,
	"frist_bis" date,
	"titel" text,
	"korrespondent" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einordnungen_art" CHECK ("einordnungen"."art" in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei')),
	CONSTRAINT "einordnungen_frist" CHECK (("einordnungen"."art" = 'frei') = ("einordnungen"."frist_bis" is null))
);
--> statement-breakpoint
CREATE TABLE "sperren" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grund" text NOT NULL,
	"von" date NOT NULL,
	"bis" date NOT NULL,
	"angelegt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"aufgehoben_am" timestamp with time zone,
	CONSTRAINT "sperren_zeitraum" CHECK ("sperren"."von" <= "sperren"."bis"),
	CONSTRAINT "sperren_grund" CHECK (length(trim("sperren"."grund")) > 0)
);
--> statement-breakpoint
ALTER TABLE "einordnungen" ADD CONSTRAINT "einordnungen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "einordnungen_dokument" ON "einordnungen" USING btree ("dokument_id","erstellt_am");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Jede Einordnung ist ab dem Einfügen fest; eine Änderung ist eine neue Zeile
SELECT belegt_seal_table('einordnungen');--> statement-breakpoint
SELECT belegt_audit_table('sperren');--> statement-breakpoint
-- Eine aufgehobene Sperre bleibt aufgehoben, Grund und Zeitraum ändern sich nie
CREATE FUNCTION belegt_sperre_nur_aufheben() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Eine Sperre wird aufgehoben, nicht gelöscht' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.aufgehoben_am IS NOT NULL OR NEW.grund IS DISTINCT FROM OLD.grund OR NEW.von IS DISTINCT FROM OLD.von
     OR NEW.bis IS DISTINCT FROM OLD.bis OR NEW.angelegt_am IS DISTINCT FROM OLD.angelegt_am OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Eine Sperre lässt sich nur einmal aufheben, sonst nicht ändern' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER sperren_nur_aufheben BEFORE UPDATE OR DELETE ON sperren FOR EACH ROW EXECUTE FUNCTION belegt_sperre_nur_aufheben();
