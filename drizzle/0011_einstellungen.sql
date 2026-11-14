CREATE TABLE "einstellungen" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"firma" text DEFAULT '' NOT NULL,
	"anschrift" text DEFAULT '' NOT NULL,
	"verantwortlich" text DEFAULT '' NOT NULL,
	"aufsicht" boolean DEFAULT false NOT NULL,
	"datensicherung" text DEFAULT '' NOT NULL,
	"scannen" text DEFAULT '' NOT NULL,
	"ergaenzungen" text DEFAULT '' NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einstellungen_eine_zeile" CHECK ("einstellungen"."id" = 1)
);
--> statement-breakpoint
SELECT belegt_audit_table('einstellungen');--> statement-breakpoint
-- Die eine Zeile gibt es von Anfang an; danach wird sie nur geändert
INSERT INTO "einstellungen" ("id") VALUES (1);
