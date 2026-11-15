CREATE TABLE "gespeicherte_ansichten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"besitzer" text NOT NULL,
	"name" text NOT NULL,
	"parameter" jsonb NOT NULL,
	"fuer_alle" boolean DEFAULT false NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gespeicherte_ansichten_name_laenge" CHECK (length(trim("gespeicherte_ansichten"."name")) between 1 and 100),
	CONSTRAINT "gespeicherte_ansichten_parameter" CHECK (jsonb_typeof("gespeicherte_ansichten"."parameter") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gespeicherte_ansichten_name" ON "gespeicherte_ansichten" USING btree ("besitzer",lower("name"));--> statement-breakpoint
CREATE INDEX "gespeicherte_ansichten_fuer_alle" ON "gespeicherte_ansichten" USING btree ("fuer_alle");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Ansichten sind Einstellungen: ändern und löschen erlaubt, aber jede Änderung steht im Audit-Log
SELECT belegt_audit_table('gespeicherte_ansichten');
