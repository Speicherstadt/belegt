CREATE TABLE "abruf_sperren" (
	"quelle_id" uuid PRIMARY KEY NOT NULL,
	"inhaber" uuid NOT NULL,
	"seit" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abruf_sperren" ADD CONSTRAINT "abruf_sperren_quelle_id_quellen_id_fk" FOREIGN KEY ("quelle_id") REFERENCES "public"."quellen"("id") ON DELETE cascade ON UPDATE no action;