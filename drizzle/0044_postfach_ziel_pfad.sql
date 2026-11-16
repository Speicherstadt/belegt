ALTER TABLE "quellen" ADD COLUMN "aktion_ziel_pfad" text;--> statement-breakpoint
SELECT set_config('belegt.actor', 'system:migration', true);--> statement-breakpoint
-- Bisher stand der Name im Ziel; bei IMAP ist er der Pfad, bei JMAP sucht die Ausführung ab jetzt die Mailbox-ID
UPDATE "quellen" SET "aktion_ziel_pfad" = "aktion_ziel" WHERE "aktion_ziel" IS NOT NULL;
