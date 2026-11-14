CREATE TABLE "archivnummern" (
	"dokument_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nummer" bigint GENERATED ALWAYS AS IDENTITY (sequence name "archivnummern_nummer_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "archivnummern_id_unique" UNIQUE("id"),
	CONSTRAINT "archivnummern_nummer_unique" UNIQUE("nummer")
);
--> statement-breakpoint
ALTER TABLE "archivnummern" ADD CONSTRAINT "archivnummern_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Versiegelt wie das Dokument: Eine vergebene Nummer lässt sich weder ändern noch löschen
SELECT belegt_seal_table('archivnummern');--> statement-breakpoint
-- Der Altbestand bekommt Nummern in der Reihenfolge des Eingangs
INSERT INTO archivnummern (dokument_id) SELECT id FROM dokumente ORDER BY eingegangen_am, id;--> statement-breakpoint
-- Jedes neue Dokument bekommt seine Nummer in derselben Transaktion; scheitert sie, bleibt die Nummer ungenutzt
CREATE FUNCTION belegt_archivnummer_vergeben() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO archivnummern (dokument_id) VALUES (NEW.id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dokumente_vergibt_archivnummer AFTER INSERT ON dokumente FOR EACH ROW
  EXECUTE FUNCTION belegt_archivnummer_vergeben();
