CREATE TABLE "dokumente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"groesse" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"dateiname" text,
	"quelle" text NOT NULL,
	"eingegangen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokumente_sha256" CHECK ("dokumente"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dokumente_groesse" CHECK ("dokumente"."groesse" >= 0)
);
--> statement-breakpoint
CREATE INDEX "dokumente_eingegangen" ON "dokumente" USING btree ("eingegangen_am");--> statement-breakpoint
CREATE INDEX "dokumente_sha256_idx" ON "dokumente" USING btree ("sha256");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Jedes Original ist ab dem Einfügen fest: Audit-Log, Siegel, Sperre gegen Ändern, Löschen und TRUNCATE
SELECT belegt_seal_table('dokumente');
