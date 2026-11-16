CREATE TABLE "benachrichtigung_einstellungen" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"anlaesse" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"an_inhaber" boolean DEFAULT true NOT NULL,
	"weitere_empfaenger" text[] DEFAULT '{}'::text[] NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benachrichtigung_einstellungen_eine_zeile" CHECK ("benachrichtigung_einstellungen"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "benachrichtigungen" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"anlass" text NOT NULL,
	"zustand" text NOT NULL,
	"empfaenger" text[] NOT NULL,
	"betreff" text NOT NULL,
	"gesendet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"fehler" text,
	CONSTRAINT "benachrichtigungen_fehler" CHECK ("benachrichtigungen"."ok" = ("benachrichtigungen"."fehler" is null))
);
--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "letzter_erfolg" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "benachrichtigungen_anlass" ON "benachrichtigungen" USING btree ("anlass","zustand","gesendet_am");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Bisher ohne Fehler abgerufene Postfächer gelten zum letzten Abruf als erfolgreich, sonst meldete die erste Runde sie
UPDATE "quellen" SET "letzter_erfolg" = "letzter_abruf" WHERE "letzter_fehler" IS NULL;--> statement-breakpoint
INSERT INTO "benachrichtigung_einstellungen" ("id") VALUES (1);--> statement-breakpoint
SELECT belegt_audit_table('benachrichtigung_einstellungen');--> statement-breakpoint
SELECT belegt_audit_table('benachrichtigungen');--> statement-breakpoint
-- Was gesendet wurde, bleibt so stehen: nur ergänzen
CREATE TRIGGER benachrichtigungen_nur_ergaenzen BEFORE UPDATE OR DELETE ON benachrichtigungen
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
