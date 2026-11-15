ALTER TABLE "regeln" ALTER COLUMN "art" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "regeln" ADD CONSTRAINT "regeln_art_oder_ordnung" CHECK ("regeln"."art" is not null
          or coalesce("regeln"."ordnung" -> 'tags', '[]'::jsonb) <> '[]'::jsonb
          or coalesce("regeln"."ordnung" -> 'dokumenttyp', 'null'::jsonb) <> 'null'::jsonb
          or coalesce("regeln"."ordnung" -> 'felder', '[]'::jsonb) <> '[]'::jsonb);