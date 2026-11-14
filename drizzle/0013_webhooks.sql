CREATE TABLE "webhook_ereignisse" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_ereignisse_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"art" text NOT NULL,
	"dokument_id" uuid NOT NULL,
	"zeitpunkt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_zustellungen" (
	"webhook_id" uuid NOT NULL,
	"ereignis_id" bigint NOT NULL,
	"zugestellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_zustellungen_webhook_id_ereignis_id_pk" PRIMARY KEY("webhook_id","ereignis_id")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"arten" text[] NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"letzte_zustellung" timestamp with time zone,
	"letzter_fehler" text,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhooks_url" CHECK ("webhooks"."url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "webhook_zustellungen" ADD CONSTRAINT "webhook_zustellungen_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_zustellungen" ADD CONSTRAINT "webhook_zustellungen_ereignis_id_webhook_ereignisse_id_fk" FOREIGN KEY ("ereignis_id") REFERENCES "public"."webhook_ereignisse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT belegt_audit_table('webhooks', 'ciphertext');--> statement-breakpoint
CREATE FUNCTION belegt_webhook_ereignis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'dokumente' THEN
    INSERT INTO webhook_ereignisse (art, dokument_id) VALUES ('dokument.aufgenommen', NEW.id);
  ELSIF TG_TABLE_NAME = 'einordnungen' THEN
    INSERT INTO webhook_ereignisse (art, dokument_id) VALUES ('dokument.eingeordnet', NEW.dokument_id);
  ELSIF TG_TABLE_NAME = 'loeschungen' AND NEW.bestaetigt_am IS NOT NULL
        AND (TG_OP = 'INSERT' OR OLD.bestaetigt_am IS NULL) THEN
    INSERT INTO webhook_ereignisse (art, dokument_id) VALUES ('dokument.geloescht', NEW.dokument_id);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER webhook_dokumente AFTER INSERT ON dokumente FOR EACH ROW EXECUTE FUNCTION belegt_webhook_ereignis();--> statement-breakpoint
CREATE TRIGGER webhook_einordnungen AFTER INSERT ON einordnungen FOR EACH ROW EXECUTE FUNCTION belegt_webhook_ereignis();--> statement-breakpoint
CREATE TRIGGER webhook_loeschungen AFTER INSERT OR UPDATE ON loeschungen FOR EACH ROW EXECUTE FUNCTION belegt_webhook_ereignis();--> statement-breakpoint
-- Ereignisse sind ein Protokoll für Empfänger: nur anhängen
CREATE FUNCTION belegt_webhook_ereignis_fest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'webhook_ereignisse: nur anhängen' USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER webhook_ereignisse_fest BEFORE UPDATE OR DELETE ON webhook_ereignisse FOR EACH ROW EXECUTE FUNCTION belegt_webhook_ereignis_fest();
