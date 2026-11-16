CREATE TABLE "kettenpruefungen" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"geprueft_am" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"befunde" bigint NOT NULL,
	"befund_liste" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eintraege" bigint NOT NULL,
	"dauer_ms" bigint NOT NULL,
	"ausgeloest_von" text NOT NULL,
	CONSTRAINT "kettenpruefungen_ok" CHECK ("kettenpruefungen"."ok" = ("kettenpruefungen"."befunde" = 0))
);
--> statement-breakpoint
CREATE INDEX "kettenpruefungen_zeit" ON "kettenpruefungen" USING btree ("geprueft_am");--> statement-breakpoint
SELECT belegt_audit_table('kettenpruefungen');--> statement-breakpoint
-- Ein Prüfergebnis bleibt so stehen: nur ergänzen
CREATE TRIGGER kettenpruefungen_nur_ergaenzen BEFORE UPDATE OR DELETE ON kettenpruefungen
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
