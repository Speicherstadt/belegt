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
  /** IMAP mit OAuth: beim Anbieter registrierte App (docs/eingang.md) */
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_TENANT: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** Anmeldung über einen OpenID-Connect-Anbieter (docs/einbetten.md) */
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_NAME: z.string().min(1).default("Firmenkonto"),
  /** Dateien in einem S3-Bucket mit Object Lock statt in DOCUMENTS_DIR (docs/betrieb.md) */
  S3_ENDPUNKT: z.string().url().optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ZUGANG_ID: z.string().min(1).optional(),
  S3_ZUGANG_GEHEIMNIS: z.string().min(1).optional(),
  S3_PFAD_STIL: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  S3_SPERRE_TAGE: z.coerce.number().int().min(0).max(36500).default(0),
  /** Zeitstempeldienst nach RFC 3161, etwa https://freetsa.org/tsr; einmal am Tag ein Zeitstempel über die Kette */
  TSA_URL: z.string().url().optional(),
  /** Sprachmodell für Vorschläge zur Einordnung, auf eigenem Server (Ollama), etwa http://ollama:11434 */
  KI_URL: z.string().url().optional(),
  KI_MODELL: z.string().min(1).optional(),
  /** „Öffnen mit …“: Name der App auf dem Knopf und ihre Adresse mit {url} (Link auf die Datei), optional {name} */
  OEFFNEN_MIT_NAME: z.string().trim().min(1).max(60).optional(),
  OEFFNEN_MIT_URL: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u) && u.includes("{url}"), "http(s)-Adresse mit {url}")
    .optional(),
  /** Vorschau-Dienst mit der Schnittstelle von Gotenberg, etwa http://gotenberg:3000; Ansichten für Office-Dateien */
  VORSCHAU_URL: z.string().url().optional(),
  /** Ordner, den der Worker überwacht (etwa Ziel eines Scanners), im Container /var/lib/belegt/eingang */
  EINGANG_ORDNER: z.string().min(1).optional(),
  /** Unterordner im Eingangsordner als Tags (jede Ebene ein Tag, angelegt, falls es ihn nicht gibt) */
  EINGANG_ORDNER_TAGS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Ordner für hochgeladene Exporte aus Paperless-ngx, den Server und Worker teilen (docs/umzug.md) */
  IMPORT_ORDNER: z.string().min(1).default("data/import"),
  /** Größte Datei eines Exports aus Paperless-ngx in GB */
  IMPORT_MAX_GB: z.coerce.number().int().min(1).max(1000).default(20),
  /** Inhalt des Barcodes auf Trennblättern, an denen ein gescannter Stapel geteilt wird */
  TRENNBLATT_CODE: z.string().trim().min(1).max(200).default("BELEGT-TRENNER"),
  /** Die eine Seite, die Belegt in einem Frame zeigen darf, etwa https://portal.firma.de */
  BELEGT_EMBED_ORIGIN: z
    .string()
    .url()
    .transform((u) => new URL(u).origin)
    .optional(),
});

export type Env = z.infer<typeof Schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  // Compose übergibt eine fehlende Variable als leeren Text; sie gilt als nicht gesetzt
  const gesetzt = Object.fromEntries(Object.entries(source).filter(([, wert]) => wert !== ""));
  const parsed = Schema.safeParse(gesetzt);
  if (!parsed.success) {
    const fehler = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ungültige Einstellungen: ${fehler}`);
  }
  return parsed.data;
}
