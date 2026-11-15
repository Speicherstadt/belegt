CREATE TABLE "import_eintraege" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"paperless_id" integer NOT NULL,
	"ergebnis" text NOT NULL,
	"dokument_id" uuid,
	"pruefsumme" text,
	"sha256" text,
	"grund" text,
	"titel" text,
	"korrespondent" text,
	"entstanden" date,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_eintraege_eindeutig" UNIQUE("import_id","paperless_id"),
	CONSTRAINT "import_eintraege_ergebnis" CHECK ("import_eintraege"."ergebnis" in ('uebernommen', 'doppelt', 'fehler')),
	CONSTRAINT "import_eintraege_dokument" CHECK (("import_eintraege"."ergebnis" = 'fehler') = ("import_eintraege"."dokument_id" is null)),
	CONSTRAINT "import_eintraege_grund" CHECK (("import_eintraege"."ergebnis" = 'fehler') = ("import_eintraege"."grund" is not null))
);
--> statement-breakpoint
CREATE TABLE "import_zuordnungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"name" text NOT NULL,
	"ziel_art" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_zuordnungen_art" CHECK ("import_zuordnungen"."art" in ('dokumenttyp', 'tag')),
	CONSTRAINT "import_zuordnungen_name" CHECK (length(trim("import_zuordnungen"."name")) between 1 and 200),
	CONSTRAINT "import_zuordnungen_ziel" CHECK ("import_zuordnungen"."ziel_art" in ('buecher', 'zoll', 'beleg', 'geschaeftsbrief', 'sonstige', 'frei'))
);
--> statement-breakpoint
CREATE TABLE "importe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"quelle_id" uuid,
	"dateiname" text,
	"status" text DEFAULT 'wartet' NOT NULL,
	"gesamt" integer,
	"abbrechen_von" text,
	"meldung" text,
	"hinweise" text[] DEFAULT '{}'::text[] NOT NULL,
	"gestartet_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"begonnen_am" timestamp with time zone,
	"beendet_am" timestamp with time zone,
	CONSTRAINT "importe_art" CHECK ("importe"."art" in ('api', 'export')),
	CONSTRAINT "importe_quelle" CHECK (("importe"."art" = 'api') = ("importe"."quelle_id" is not null)),
	CONSTRAINT "importe_status" CHECK ("importe"."status" in ('wartet', 'laeuft', 'fertig', 'abgebrochen', 'fehler'))
);
--> statement-breakpoint
CREATE TABLE "paperless_quellen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paperless_quellen_url" CHECK ("paperless_quellen"."url" ~ '^https?://[^/]+(/.*[^/])?$'),
	CONSTRAINT "paperless_quellen_name" CHECK (length(trim("paperless_quellen"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "import_eintraege" ADD CONSTRAINT "import_eintraege_import_id_importe_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."importe"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_eintraege" ADD CONSTRAINT "import_eintraege_dokument_id_dokumente_id_fk" FOREIGN KEY ("dokument_id") REFERENCES "public"."dokumente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importe" ADD CONSTRAINT "importe_quelle_id_paperless_quellen_id_fk" FOREIGN KEY ("quelle_id") REFERENCES "public"."paperless_quellen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_eintraege_dokument_idx" ON "import_eintraege" USING btree ("dokument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_zuordnungen_eindeutig" ON "import_zuordnungen" USING btree ("art",lower("name"));--> statement-breakpoint
CREATE INDEX "importe_quelle_idx" ON "importe" USING btree ("quelle_id");--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Das API-Token steht nur verschlüsselt in ciphertext und nie im Audit-Log, wie das Passwort eines Postfachs
SELECT belegt_audit_table('paperless_quellen', 'ciphertext');--> statement-breakpoint
SELECT belegt_audit_table('importe');--> statement-breakpoint
SELECT belegt_audit_table('import_zuordnungen');--> statement-breakpoint
-- Das Ergebnis je Paperless-Dokument belegt den Abgleich der Prüfsumme: versiegelt, nur ergänzen
SELECT belegt_seal_table('import_eintraege');
