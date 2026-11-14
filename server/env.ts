import { z } from "zod";

/** Einstellungen aus der Umgebung; fehlt etwas Nötiges, startet der Server nicht. */
const Schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Postgres; nur der Server braucht sie, Tests nutzen TEST_DATABASE_URL */
  DATABASE_URL: z.string().url().optional(),
  /** Wurzel des Dateispeichers (Dateien unter ihrem SHA-256) */
  DOCUMENTS_DIR: z.string().min(1).default("data/dokumente"),
  /** Schlüssel für Sitzungen; mindestens 32 Zeichen, etwa aus openssl rand -hex 32 */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /** Adresse, unter der Belegt erreichbar ist, etwa https://belegt.firma.de */
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof Schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) {
    const fehler = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ungültige Einstellungen: ${fehler}`);
  }
  return parsed.data;
}
