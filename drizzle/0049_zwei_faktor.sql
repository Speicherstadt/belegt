CREATE TABLE "anmeldung_einstellungen" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"zwei_faktor_pflicht" text[] DEFAULT '{}'::text[] NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anmeldung_einstellungen_eine_zeile" CHECK ("anmeldung_einstellungen"."id" = 1),
	CONSTRAINT "anmeldung_einstellungen_rollen" CHECK ("anmeldung_einstellungen"."zwei_faktor_pflicht" <@ array['inhaber', 'steuerberatung', 'pruefer', 'mitarbeiter']::text[])
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "anmeldeweg" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_unique" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_id_unique" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
INSERT INTO "anmeldung_einstellungen" ("id") VALUES (1);--> statement-breakpoint
-- Zweiter Faktor ins Audit-Log, ohne TOTP-Geheimnis und Backup-Codes; vom Passkey steht nur der öffentliche Schlüssel da
SELECT belegt_audit_table('two_factor', 'secret', 'backup_codes');--> statement-breakpoint
SELECT belegt_audit_table('passkey');--> statement-breakpoint
SELECT belegt_audit_table('anmeldung_einstellungen');
