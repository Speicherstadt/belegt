CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"recht" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"widerrufen_am" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_recht" CHECK ("api_tokens"."recht" in ('lesen', 'schreiben')),
	CONSTRAINT "api_tokens_name" CHECK (length(trim("api_tokens"."name")) > 0)
);
--> statement-breakpoint
SELECT belegt_audit_table('api_tokens', 'token_hash');
