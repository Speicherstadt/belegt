CREATE TABLE "fristvorlagen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monate" integer NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fristvorlagen_name_laenge" CHECK (length(trim("fristvorlagen"."name")) between 1 and 100),
	CONSTRAINT "fristvorlagen_monate" CHECK ("fristvorlagen"."monate" between 1 and 1200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fristvorlagen_name" ON "fristvorlagen" USING btree (lower("name"));--> statement-breakpoint
SELECT belegt_audit_table('fristvorlagen');
