CREATE TABLE "ki_vorschlaege" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"vorschlag" jsonb,
	"modell" text NOT NULL,
	"fehler" text,
	"erzeugt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ki_vorschlaege" ADD CONSTRAINT "ki_vorschlaege_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;