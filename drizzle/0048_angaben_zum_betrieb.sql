-- Angaben zum Betrieb nach dem Schema des GoBD-Kerns: neue Felder leer, vorhandene Werte bleiben in ihren Spalten
ALTER TABLE "einstellungen" ADD COLUMN "rechtsform" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "einstellungen" ADD COLUMN "aufbewahrungsort" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "einstellungen" ADD COLUMN "serverbetrieb" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "einstellungen" ADD COLUMN "schluesselablage" text DEFAULT '' NOT NULL;