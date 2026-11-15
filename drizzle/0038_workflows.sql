CREATE TABLE "workflow_laeufe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_name" text NOT NULL,
	"dokument_id" uuid NOT NULL,
	"ausloeser" text NOT NULL,
	"ereignis_id" bigint,
	"ergebnis" text NOT NULL,
	"aktionen" jsonb,
	"fehler" text,
	"zeitpunkt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_laeufe_einmal" UNIQUE("workflow_id","dokument_id"),
	CONSTRAINT "workflow_laeufe_ergebnis" CHECK ("workflow_laeufe"."ergebnis" in ('ausgefuehrt', 'trifft_nicht', 'angehalten', 'fehler')),
	CONSTRAINT "workflow_laeufe_fehler" CHECK (("workflow_laeufe"."ergebnis" = 'fehler') = ("workflow_laeufe"."fehler" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"ausloeser" text NOT NULL,
	"bedingungen" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"aktionen" jsonb NOT NULL,
	"anhalten" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_name_laenge" CHECK (length(trim("workflows"."name")) between 1 and 100),
	CONSTRAINT "workflows_ausloeser" CHECK ("workflows"."ausloeser" in ('eingang', 'eingeordnet')),
	CONSTRAINT "workflows_aktionen" CHECK (jsonb_typeof("workflows"."aktionen") = 'array' and jsonb_array_length("workflows"."aktionen") between 1 and 20),
	CONSTRAINT "workflows_einordnung_ausdruecklich" CHECK (jsonb_path_query_array("workflows"."aktionen", '$[*] ? (@.art == "einordnen")')
          = jsonb_path_query_array("workflows"."aktionen", '$[*] ? (@.art == "einordnen" && @.ausdruecklich == true)'))
);
--> statement-breakpoint
ALTER TABLE "webhook_ereignisse" ADD COLUMN "workflow" text;--> statement-breakpoint
ALTER TABLE "workflow_laeufe" ADD CONSTRAINT "workflow_laeufe_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_laeufe_zeit" ON "workflow_laeufe" USING btree ("zeitpunkt");--> statement-breakpoint
CREATE INDEX "workflow_laeufe_dokument" ON "workflow_laeufe" USING btree ("dokument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_name" ON "workflows" USING btree (lower("name"));--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
SELECT belegt_audit_table('workflows');--> statement-breakpoint
SELECT belegt_audit_table('workflow_laeufe');--> statement-breakpoint
-- Läufe sind ein Protokoll: nur anhängen, wie die Ereignisse der Webhooks
CREATE FUNCTION belegt_workflow_lauf_fest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workflow_laeufe: nur anhängen' USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER workflow_laeufe_fest BEFORE UPDATE OR DELETE ON workflow_laeufe FOR EACH ROW
  EXECUTE FUNCTION belegt_workflow_lauf_fest();--> statement-breakpoint
-- Ein gelöschtes Dokument bearbeitet kein Workflow mehr; die Sperre je Dokument (0025) ordnet das gegen eine
-- gleichzeitige Löschung
CREATE FUNCTION belegt_workflow_lauf_nicht_nach_loeschung() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('belegt_inhalt:' || NEW.dokument_id::text, 0));
  IF NEW.ergebnis = 'ausgefuehrt'
     AND EXISTS (SELECT 1 FROM loeschungen l WHERE l.dokument_id = NEW.dokument_id AND l.bestaetigt_am IS NOT NULL) THEN
    RAISE EXCEPTION 'Das Dokument ist gelöscht' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER workflow_laeufe_nicht_nach_loeschung BEFORE INSERT ON workflow_laeufe FOR EACH ROW
  EXECUTE FUNCTION belegt_workflow_lauf_nicht_nach_loeschung();
