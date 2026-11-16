CREATE TABLE "weitergaben" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_name" text NOT NULL,
	"position" smallint NOT NULL,
	"dokument_id" uuid NOT NULL,
	"stand" text DEFAULT 'offen' NOT NULL,
	"versuche" integer DEFAULT 0 NOT NULL,
	"naechster_versuch" timestamp with time zone DEFAULT now() NOT NULL,
	"letzter_versuch" timestamp with time zone,
	"http_status" integer,
	"fehler" text,
	"gesendet_am" timestamp with time zone,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weitergaben_einmal" UNIQUE("workflow_id","position","dokument_id"),
	CONSTRAINT "weitergaben_stand" CHECK ("weitergaben"."stand" in ('offen', 'gesendet', 'fehlgeschlagen', 'entfallen')),
	CONSTRAINT "weitergaben_gesendet" CHECK (("weitergaben"."stand" = 'gesendet') = ("weitergaben"."gesendet_am" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_geheimnisse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "workflow_geheimnisse_einmal" UNIQUE("workflow_id","position")
);
--> statement-breakpoint
ALTER TABLE "weitergaben" ADD CONSTRAINT "weitergaben_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_geheimnisse" ADD CONSTRAINT "workflow_geheimnisse_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weitergaben_faellig" ON "weitergaben" USING btree ("stand","naechster_versuch");--> statement-breakpoint
CREATE INDEX "weitergaben_dokument" ON "weitergaben" USING btree ("dokument_id");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Der Wert der Kopfzeile steht nur verschlüsselt in ciphertext und nie im Audit-Log, wie das Passwort eines Postfachs
SELECT belegt_audit_table('workflow_geheimnisse', 'ciphertext');--> statement-breakpoint
SELECT belegt_audit_table('weitergaben');--> statement-breakpoint
-- Höchstens ein erfolgreicher Versand je Dokument und Aktion: Eine gesendete Weitergabe bleibt, wie sie ist
CREATE FUNCTION belegt_weitergabe_gesendet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'weitergaben: schon gesendet' USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER weitergaben_gesendet_fest BEFORE UPDATE OR DELETE ON weitergaben FOR EACH ROW
  WHEN (OLD.stand = 'gesendet') EXECUTE FUNCTION belegt_weitergabe_gesendet();
