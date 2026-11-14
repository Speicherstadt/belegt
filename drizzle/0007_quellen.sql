CREATE TABLE "quellen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 993 NOT NULL,
	"tls" boolean DEFAULT true NOT NULL,
	"benutzer" text NOT NULL,
	"ordner" text DEFAULT 'INBOX' NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"letzte_uid" bigint DEFAULT 0 NOT NULL,
	"uid_validity" bigint,
	"letzter_abruf" timestamp with time zone,
	"letzter_fehler" text,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quellen_port" CHECK ("quellen"."port" between 1 and 65535)
);
--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
SELECT belegt_audit_table('quellen', 'ciphertext');
