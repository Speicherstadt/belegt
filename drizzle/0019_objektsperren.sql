CREATE TABLE "objektsperren" (
	"sha256" text PRIMARY KEY NOT NULL,
	"bis" date NOT NULL,
	"gesetzt_am" timestamp with time zone DEFAULT now() NOT NULL
);
