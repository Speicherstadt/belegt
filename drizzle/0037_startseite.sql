CREATE TABLE "start_kacheln" (
	"besitzer" text NOT NULL,
	"ansicht_id" uuid NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "start_kacheln_besitzer_ansicht_id_pk" PRIMARY KEY("besitzer","ansicht_id")
);
--> statement-breakpoint
ALTER TABLE "start_kacheln" ADD CONSTRAINT "start_kacheln_ansicht_id_gespeicherte_ansichten_id_fk" FOREIGN KEY ("ansicht_id") REFERENCES "public"."gespeicherte_ansichten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "start_kacheln_ansicht" ON "start_kacheln" USING btree ("ansicht_id");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Kacheln sind Einstellungen wie die Ansichten selbst: änderbar, jede Änderung im Audit-Log
SELECT belegt_audit_table('start_kacheln');
