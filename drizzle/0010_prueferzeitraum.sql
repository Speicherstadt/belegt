-- NOT VALID: Ältere Prüfer-Zugänge und -Einladungen haben keinen Zeitraum; sie sehen nichts (server/zugang/pruefer.ts).
-- Neue und geänderte Zeilen prüft Postgres.
ALTER TABLE "einladungen" ADD COLUMN "zeitraum_von" date;--> statement-breakpoint
ALTER TABLE "einladungen" ADD COLUMN "zeitraum_bis" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "zeitraum_von" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "zeitraum_bis" date;--> statement-breakpoint
ALTER TABLE "einladungen" ADD CONSTRAINT "einladungen_zeitraum" CHECK (case when "einladungen"."rolle" = 'pruefer' then "einladungen"."zeitraum_von" is not null and "einladungen"."zeitraum_bis" is not null and "einladungen"."zeitraum_von" <= "einladungen"."zeitraum_bis" else "einladungen"."zeitraum_von" is null and "einladungen"."zeitraum_bis" is null end) NOT VALID;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_zeitraum" CHECK (case when "user"."role" = 'pruefer' then "user"."zeitraum_von" is not null and "user"."zeitraum_bis" is not null and "user"."zeitraum_von" <= "user"."zeitraum_bis" else "user"."zeitraum_von" is null and "user"."zeitraum_bis" is null end) NOT VALID;
--> statement-breakpoint
-- Tag, nach dem ein Dokument zu einem Zeitraum gehört: Entstehung laut neuester Einordnung, sonst der Eingang (Berlin)
CREATE FUNCTION belegt_dokument_tag(dok uuid) RETURNS date LANGUAGE sql STABLE AS $$
  select coalesce(
    (select e.entstanden from einordnungen e where e.dokument_id = dok order by e.erstellt_am desc, e.id desc limit 1),
    (select (d.eingegangen_am at time zone 'Europe/Berlin')::date from dokumente d where d.id = dok))
$$;
