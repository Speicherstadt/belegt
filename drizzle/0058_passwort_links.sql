CREATE TABLE "passwort_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gueltig_bis" timestamp with time zone NOT NULL,
	"eingeloest_am" timestamp with time zone,
	CONSTRAINT "passwort_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "passwort_links" ADD CONSTRAINT "passwort_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passwort_links_user_id_idx" ON "passwort_links" USING btree ("user_id");--> statement-breakpoint
-- Ins Audit-Log, ohne den Hash des Tokens
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
SELECT belegt_audit_table('passwort_links', 'token_hash');
