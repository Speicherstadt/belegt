CREATE TABLE "postfach_aktionen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"postfach_mail_id" uuid NOT NULL,
	"quelle_id" uuid NOT NULL,
	"dokument_id" uuid NOT NULL,
	"aktion" text NOT NULL,
	"ziel" text,
	"ordner" text NOT NULL,
	"uid_validity" bigint,
	"uid" bigint,
	"jmap_id" text,
	"ergebnis" text NOT NULL,
	"meldung" text,
	"zeit" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postfach_aktionen_aktion" CHECK ("postfach_aktionen"."aktion" in ('keine', 'gelesen', 'markieren', 'verschieben', 'loeschen')),
	CONSTRAINT "postfach_aktionen_ergebnis" CHECK ("postfach_aktionen"."ergebnis" in ('ausgefuehrt', 'entfallen', 'fehler'))
);
--> statement-breakpoint
CREATE TABLE "postfach_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quelle_id" uuid NOT NULL,
	"dokument_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"ordner" text NOT NULL,
	"uid_validity" bigint,
	"uid" bigint,
	"jmap_id" text,
	"archiviert_am" timestamp with time zone NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"versuche" integer DEFAULT 0 NOT NULL,
	"naechster_versuch" timestamp with time zone DEFAULT now() NOT NULL,
	"letzter_fehler" text,
	CONSTRAINT "postfach_mails_status" CHECK ("postfach_mails"."status" in ('offen', 'erledigt', 'entfallen', 'fehlgeschlagen')),
	CONSTRAINT "postfach_mails_adresse" CHECK (("postfach_mails"."uid" is not null and "postfach_mails"."uid_validity" is not null) or "postfach_mails"."jmap_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "aktion" text DEFAULT 'keine' NOT NULL;--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "aktion_ziel" text;--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "loeschen_warte_stunden" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "loeschen_nach_sperre" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "loeschen_bestaetigt_von" text;--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "loeschen_bestaetigt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "postfach_aktionen" ADD CONSTRAINT "postfach_aktionen_postfach_mail_id_postfach_mails_id_fk" FOREIGN KEY ("postfach_mail_id") REFERENCES "public"."postfach_mails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postfach_aktionen" ADD CONSTRAINT "postfach_aktionen_quelle_id_quellen_id_fk" FOREIGN KEY ("quelle_id") REFERENCES "public"."quellen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postfach_aktionen" ADD CONSTRAINT "postfach_aktionen_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postfach_mails" ADD CONSTRAINT "postfach_mails_quelle_id_quellen_id_fk" FOREIGN KEY ("quelle_id") REFERENCES "public"."quellen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postfach_mails" ADD CONSTRAINT "postfach_mails_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postfach_aktionen_quelle" ON "postfach_aktionen" USING btree ("quelle_id","zeit");--> statement-breakpoint
CREATE UNIQUE INDEX "postfach_mails_imap" ON "postfach_mails" USING btree ("quelle_id","ordner","uid_validity","uid");--> statement-breakpoint
CREATE UNIQUE INDEX "postfach_mails_jmap" ON "postfach_mails" USING btree ("quelle_id","jmap_id");--> statement-breakpoint
CREATE INDEX "postfach_mails_offen" ON "postfach_mails" USING btree ("quelle_id","status","naechster_versuch");--> statement-breakpoint
ALTER TABLE "quellen" ADD CONSTRAINT "quellen_aktion" CHECK ("quellen"."aktion" in ('keine', 'gelesen', 'markieren', 'verschieben', 'loeschen'));--> statement-breakpoint
ALTER TABLE "quellen" ADD CONSTRAINT "quellen_aktion_ziel" CHECK (("quellen"."aktion" = 'verschieben') = ("quellen"."aktion_ziel" is not null));--> statement-breakpoint
ALTER TABLE "quellen" ADD CONSTRAINT "quellen_loeschen_bestaetigt" CHECK ("quellen"."aktion" <> 'loeschen' or ("quellen"."loeschen_bestaetigt_von" is not null and "quellen"."loeschen_bestaetigt_am" is not null));--> statement-breakpoint
ALTER TABLE "quellen" ADD CONSTRAINT "quellen_loeschen_warten" CHECK ("quellen"."loeschen_warte_stunden" between 1 and 2160);--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
SELECT belegt_audit_table('postfach_mails');--> statement-breakpoint
SELECT belegt_audit_table('postfach_aktionen');--> statement-breakpoint
-- Das Protokoll der Aktionen wächst nur an: nichts lässt sich ändern oder aus dem Nachweis löschen
CREATE TRIGGER postfach_aktionen_nur_ergaenzen BEFORE UPDATE OR DELETE ON postfach_aktionen
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
--> statement-breakpoint
-- Eine Mail kommt erst in die Warteschlange, wenn sie als Mail mit diesem Hash im Archiv liegt
CREATE FUNCTION belegt_postfach_mail_archiviert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dokumente d JOIN mails m ON m.dokument_id = d.id
                  WHERE d.id = NEW.dokument_id AND d.sha256 = NEW.sha256) THEN
    RAISE EXCEPTION 'Die Mail liegt nicht im Archiv' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER postfach_mails_archiviert BEFORE INSERT OR UPDATE OF dokument_id, sha256 ON postfach_mails
  FOR EACH ROW EXECUTE FUNCTION belegt_postfach_mail_archiviert();
