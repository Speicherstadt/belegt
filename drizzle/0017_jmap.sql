ALTER TABLE "quellen" ADD COLUMN "art" text DEFAULT 'imap' NOT NULL;--> statement-breakpoint
ALTER TABLE "quellen" ADD COLUMN "jmap_stand" text;--> statement-breakpoint
ALTER TABLE "quellen" ADD CONSTRAINT "quellen_art" CHECK ("quellen"."art" in ('imap', 'jmap'));