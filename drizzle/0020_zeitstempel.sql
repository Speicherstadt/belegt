CREATE TABLE "zeitstempel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint NOT NULL,
	"hash" text NOT NULL,
	"dienst" text NOT NULL,
	"zeit" timestamp with time zone NOT NULL,
	"seriennummer" text NOT NULL,
	"token" "bytea" NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
SELECT belegt_seal_table('zeitstempel');
