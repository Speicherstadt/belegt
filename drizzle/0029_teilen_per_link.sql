CREATE TABLE "freigabe_abrufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freigabe_id" uuid NOT NULL,
	"abgerufen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freigabe_widerrufe" (
	"freigabe_id" uuid PRIMARY KEY NOT NULL,
	"widerrufen_von" text NOT NULL,
	"widerrufen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freigaben" ADD COLUMN "zweck" text DEFAULT 'oeffnen' NOT NULL;--> statement-breakpoint
ALTER TABLE "freigabe_abrufe" ADD CONSTRAINT "freigabe_abrufe_freigabe_id_freigaben_id_fk" FOREIGN KEY ("freigabe_id") REFERENCES "public"."freigaben"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freigabe_widerrufe" ADD CONSTRAINT "freigabe_widerrufe_freigabe_id_freigaben_id_fk" FOREIGN KEY ("freigabe_id") REFERENCES "public"."freigaben"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "freigabe_abrufe_freigabe" ON "freigabe_abrufe" USING btree ("freigabe_id");--> statement-breakpoint
ALTER TABLE "freigaben" ADD CONSTRAINT "freigaben_zweck" CHECK ("freigaben"."zweck" in ('oeffnen', 'teilen'));--> statement-breakpoint
ALTER TABLE "freigaben" ADD CONSTRAINT "freigaben_teilen_dauer" CHECK ("freigaben"."zweck" <> 'teilen' or "freigaben"."gueltig_bis" <= "freigaben"."erstellt_am" + interval '31 days');--> statement-breakpoint
SELECT belegt_audit_table('freigabe_widerrufe');
--> statement-breakpoint
SELECT belegt_audit_table('freigabe_abrufe');
--> statement-breakpoint
-- Widerruf und Abrufe bleiben wie die Freigabe selbst: nichts lässt sich ändern oder aus dem Nachweis löschen
CREATE TRIGGER freigabe_widerrufe_nur_ergaenzen BEFORE UPDATE OR DELETE ON freigabe_widerrufe
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
--> statement-breakpoint
CREATE TRIGGER freigabe_abrufe_nur_ergaenzen BEFORE UPDATE OR DELETE ON freigabe_abrufe
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
--> statement-breakpoint
-- Widerrufen und abgerufen wird nur ein geteilter Link; abgerufen nur, solange er gilt und nicht widerrufen ist
CREATE FUNCTION belegt_freigabe_geteilt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f freigaben;
BEGIN
  SELECT * INTO f FROM freigaben WHERE id = NEW.freigabe_id;
  IF f.zweck IS DISTINCT FROM 'teilen' THEN
    RAISE EXCEPTION 'Nur ein geteilter Link lässt sich widerrufen oder abrufen' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'freigabe_abrufe'
     AND (f.gueltig_bis <= now() OR EXISTS (SELECT 1 FROM freigabe_widerrufe w WHERE w.freigabe_id = f.id)) THEN
    RAISE EXCEPTION 'Der Link ist abgelaufen oder widerrufen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER freigabe_widerrufe_geteilt BEFORE INSERT ON freigabe_widerrufe
  FOR EACH ROW EXECUTE FUNCTION belegt_freigabe_geteilt();
--> statement-breakpoint
CREATE TRIGGER freigabe_abrufe_geteilt BEFORE INSERT ON freigabe_abrufe
  FOR EACH ROW EXECUTE FUNCTION belegt_freigabe_geteilt();
