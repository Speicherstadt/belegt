CREATE TABLE "backup_status" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	"art" text NOT NULL,
	"ok" boolean NOT NULL,
	"snapshot" text,
	"bytes" bigint,
	"meldung" text DEFAULT '' NOT NULL,
	"ziel" text,
	"zeitplan" text,
	CONSTRAINT "backup_status_art" CHECK ("backup_status"."art" in ('backup', 'restore_check'))
);
--> statement-breakpoint
CREATE INDEX "backup_status_art_am" ON "backup_status" USING btree ("art","am");--> statement-breakpoint
SELECT belegt_audit_table('backup_status');--> statement-breakpoint
-- Ein Lauf ist geschehen, wie er eingetragen ist: nur ergänzen
CREATE TRIGGER backup_status_nur_ergaenzen BEFORE UPDATE OR DELETE ON backup_status
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
