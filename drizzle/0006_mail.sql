CREATE TABLE "mail_anhaenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mail_dokument_id" uuid NOT NULL,
	"anhang_dokument_id" uuid NOT NULL,
	"eingebettet" boolean NOT NULL,
	CONSTRAINT "mail_anhaenge_anhang_dokument_id_unique" UNIQUE("anhang_dokument_id")
);
--> statement-breakpoint
CREATE TABLE "mails" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"antwort_auf" text,
	"verweise" text[] NOT NULL,
	"von" text,
	"an" text[] NOT NULL,
	"betreff" text NOT NULL,
	"gesendet_am" timestamp with time zone,
	"text" text NOT NULL,
	CONSTRAINT "mails_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "regeln" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"bedingung" jsonb NOT NULL,
	"art" text NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regeln_art" CHECK ("regeln"."art" in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'freiwillig', 'frei'))
);
--> statement-breakpoint
ALTER TABLE "mail_anhaenge" ADD CONSTRAINT "mail_anhaenge_mail_dokument_id_dokumente_id_fk" FOREIGN KEY ("mail_dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_anhaenge" ADD CONSTRAINT "mail_anhaenge_anhang_dokument_id_dokumente_id_fk" FOREIGN KEY ("anhang_dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mails" ADD CONSTRAINT "mails_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_anhaenge_mail" ON "mail_anhaenge" USING btree ("mail_dokument_id");--> statement-breakpoint
CREATE INDEX "mails_message_id" ON "mails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mails_von" ON "mails" USING btree ("von");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- mails hat als Schlüssel dokument_id; versiegelt wird über die eigene uuid-Spalte id
SELECT belegt_seal_table('mails');--> statement-breakpoint
SELECT belegt_seal_table('mail_anhaenge');--> statement-breakpoint
SELECT belegt_audit_table('regeln');
