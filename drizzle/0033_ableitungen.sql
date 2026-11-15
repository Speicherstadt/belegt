CREATE TABLE "ableitungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"quelle_id" uuid NOT NULL,
	"position" smallint DEFAULT 1 NOT NULL,
	"operation" text NOT NULL,
	"parameter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"akteur" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ableitungen_eindeutig" UNIQUE("dokument_id","position"),
	CONSTRAINT "ableitungen_operation" CHECK ("ableitungen"."operation" in ('drehen', 'entfernen', 'teilen', 'zusammenfuegen')),
	CONSTRAINT "ableitungen_nicht_selbst" CHECK ("ableitungen"."dokument_id" <> "ableitungen"."quelle_id"),
	CONSTRAINT "ableitungen_position" CHECK ("ableitungen"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ableitungen" ADD CONSTRAINT "ableitungen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ableitungen" ADD CONSTRAINT "ableitungen_quelle_id_dokumente_id_fk" FOREIGN KEY ("quelle_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ableitungen_quelle" ON "ableitungen" USING btree ("quelle_id");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Die Verknüpfung ist wie das Dokument selbst ab dem Einfügen versiegelt: nur ergänzen, mit Siegel und im Audit-Log
SELECT belegt_seal_table('ableitungen');--> statement-breakpoint
-- Abgeleitet wird nur ein Dokument mit Quelle „abgeleitet“, und nur aus einer Quelle, die nicht gelöscht ist
CREATE FUNCTION belegt_ableitung_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dokumente d WHERE d.id = NEW.dokument_id AND d.quelle = 'abgeleitet') THEN
    RAISE EXCEPTION 'Nur ein abgeleitetes Dokument hat eine Quelle' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = NEW.quelle_id AND l.bestaetigt_am IS NOT NULL) THEN
    RAISE EXCEPTION 'Die Quelle ist gelöscht' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ableitungen_pruefen BEFORE INSERT ON ableitungen FOR EACH ROW EXECUTE FUNCTION belegt_ableitung_pruefen();
