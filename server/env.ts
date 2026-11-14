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
  /** Schlüssel für Geheimnisse in der Datenbank (Passwörter von Postfächern), 32 Bytes base64 */
  BELEGT_SCHLUESSEL: z.string().min(40).optional(),
  /** Abstand zwischen zwei Abrufen der Postfächer im Worker, in Minuten */
  ABRUF_MINUTEN: z.coerce.number().int().min(1).max(1440).default(5),
  /** SMTP-Journal (bun server/smtp.ts): Port, erlaubte Empfänger (mit Komma getrennt, leer: alle), TLS-Schlüssel und -Zertifikat */
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(2525),
  SMTP_EMPFAENGER: z.string().optional(),
  SMTP_TLS_KEY: z.string().min(1).optional(),
  SMTP_TLS_CERT: z.string().min(1).optional(),
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
