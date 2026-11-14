CREATE TABLE "offene_entfernungen" (
	"sha256" text PRIMARY KEY NOT NULL,
	"seit" timestamp with time zone DEFAULT now() NOT NULL
);
