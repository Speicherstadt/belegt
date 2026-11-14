CREATE TABLE "freigaben" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dokument_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gueltig_bis" timestamp with time zone NOT NULL,
	CONSTRAINT "freigaben_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "freigaben" ADD CONSTRAINT "freigaben_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT belegt_audit_table('freigaben', 'token_hash');
--> statement-breakpoint
-- Eine Freigabe lässt sich weder verlängern noch auf ein anderes Dokument umbiegen, noch aus dem Nachweis löschen
CREATE TRIGGER freigaben_nur_ergaenzen BEFORE UPDATE OR DELETE ON freigaben
  FOR EACH ROW EXECUTE FUNCTION belegt_append_only();
