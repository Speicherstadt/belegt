CREATE TABLE "einlieferungen" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"nutzer_id" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "einladungen" DROP CONSTRAINT "einladungen_rolle";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_role";--> statement-breakpoint
ALTER TABLE "einladungen" ADD COLUMN "recht" text;--> statement-breakpoint
ALTER TABLE "einladungen" ADD COLUMN "sichtbereich" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "recht" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "sichtbereich" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "entzogen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "einlieferungen" ADD CONSTRAINT "einlieferungen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einlieferungen" ADD CONSTRAINT "einlieferungen_nutzer_id_user_id_fk" FOREIGN KEY ("nutzer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einladungen" ADD CONSTRAINT "einladungen_mitarbeiter" CHECK (case when "einladungen"."rolle" = 'mitarbeiter' then coalesce("einladungen"."recht" in ('lesen', 'bearbeiten') and jsonb_typeof("einladungen"."sichtbereich") = 'object', false) else "einladungen"."recht" is null and "einladungen"."sichtbereich" is null end);--> statement-breakpoint
ALTER TABLE "einladungen" ADD CONSTRAINT "einladungen_rolle" CHECK ("einladungen"."rolle" in ('steuerberatung', 'pruefer', 'mitarbeiter'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_mitarbeiter" CHECK (case when "user"."role" = 'mitarbeiter' then coalesce("user"."recht" in ('lesen', 'bearbeiten') and jsonb_typeof("user"."sichtbereich") = 'object', false) else "user"."recht" is null and "user"."sichtbereich" is null end);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_entzogen" CHECK ("user"."entzogen_am" is null or "user"."role" <> 'inhaber');--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role" CHECK ("user"."role" in ('inhaber', 'steuerberatung', 'pruefer', 'mitarbeiter'));--> statement-breakpoint
SELECT belegt_audit_table('einlieferungen');
