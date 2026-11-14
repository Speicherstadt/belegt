CREATE TABLE "einladungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"rolle" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gueltig_bis" timestamp with time zone NOT NULL,
	"eingeloest_am" timestamp with time zone,
	"eingeloest_von" text,
	"zurueckgezogen_am" timestamp with time zone,
	CONSTRAINT "einladungen_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "einladungen_rolle" CHECK ("einladungen"."rolle" in ('steuerberatung', 'pruefer'))
);
--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
SELECT belegt_audit_table('einladungen', 'token_hash');
