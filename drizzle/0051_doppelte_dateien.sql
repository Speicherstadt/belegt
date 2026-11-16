CREATE TABLE "mail_verweise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mail_dokument_id" uuid NOT NULL,
	"dokument_id" uuid NOT NULL,
	"dateiname" text,
	"eingebettet" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_verweise" ADD CONSTRAINT "mail_verweise_mail_dokument_id_dokumente_id_fk" FOREIGN KEY ("mail_dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_verweise" ADD CONSTRAINT "mail_verweise_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_verweise_mail" ON "mail_verweise" USING btree ("mail_dokument_id");--> statement-breakpoint
CREATE INDEX "mail_verweise_dokument" ON "mail_verweise" USING btree ("dokument_id");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Wie mail_anhaenge: versiegelt, nur ergänzen
SELECT belegt_seal_table('mail_verweise');
