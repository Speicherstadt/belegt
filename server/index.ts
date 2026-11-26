import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { mailAusEnv } from "./benachrichtigungen/versand.ts";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { datenbankVorbereiten } from "./db/migrieren.ts";
import { zugriffWarnung } from "./db/rollen.ts";
import { eingerichtet } from "./db/status.ts";
import { readEnv } from "./env.ts";
import { clientIp, proxysLesen } from "./http/client-ip.ts";
import { imapOeffnen } from "./mail/imapflow.ts";
import { oauthAusEnv } from "./mail/oauth.ts";
import { speicherAusEnv } from "./speicher/auswahl.ts";

const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET fehlt (mindestens 32 Zeichen)");

// Getrennte Rollen: migriert mit MIGRATION_DATABASE_URL, sonst wie bisher mit DATABASE_URL (dann mit Warnung)
const zugriff = await datenbankVorbereiten({ appUrl: env.DATABASE_URL, migrationUrl: env.MIGRATION_DATABASE_URL });
const warnung = zugriffWarnung(zugriff);
if (warnung) console.warn(warnung);
const { db } = verbinden(env.DATABASE_URL);
const { speicher, sperrbar } = speicherAusEnv(env);
// Einrichtungscode für das erste Konto: bei jedem Start neu, nur im Log
const einrichtungscode = randomBytes(9).toString("base64url");
if (!(await eingerichtet(db))) console.log(`Belegt ist noch nicht eingerichtet. Einrichtungscode: ${einrichtungscode}`);
const oidc =
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET
    ? {
        issuer: env.OIDC_ISSUER,
        clientId: env.OIDC_CLIENT_ID,
        clientSecret: env.OIDC_CLIENT_SECRET,
        name: env.OIDC_NAME,
      }
    : undefined;
const auth = createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, einrichtungscode, oidc });
const schluessel = env.BELEGT_SCHLUESSEL ? schluesselAus(env.BELEGT_SCHLUESSEL) : undefined;
// Die gebaute Oberfläche liefert der Server selbst aus, wenn es sie gibt (bun run build); sonst Vite in der Entwicklung
const oberflaeche = existsSync("dist/index.html") ? "dist" : undefined;
// Adresse der Verbindung je Anfrage für Better Auth; X-Forwarded-For nur von BELEGT_TRUSTED_PROXIES
const verbindungen = new WeakMap<Request, string | undefined>();
const proxys = proxysLesen(env.BELEGT_TRUSTED_PROXIES);
const app = createApp({
  clientIp: (req) => clientIp(verbindungen.get(req), req.headers.get("x-forwarded-for"), proxys),
  db,
  speicher,
  auth,
  schluessel,
  oeffnen: imapOeffnen,
  abrufMinuten: env.ABRUF_MINUTEN,
  oauth: oauthAusEnv(env),
  oidcName: oidc?.name,
  embedOrigin: env.BELEGT_EMBED_ORIGIN,
  objektsperre: !!sperrbar,
  s3Verschluesselt: !!(sperrbar && env.S3_SCHLUESSEL),
  eingangsordner: !!env.EINGANG_ORDNER,
  speicherOrdner: env.S3_ENDPUNKT ? undefined : env.DOCUMENTS_DIR,
  erechnungPruefung: !!env.VALIDATOR_URL,
  trennblattCode: env.TRENNBLATT_CODE,
  kiModell: env.KI_URL && env.KI_MODELL ? { modell: env.KI_MODELL, host: new URL(env.KI_URL).host } : undefined,
  oeffnenMit:
    env.OEFFNEN_MIT_NAME && env.OEFFNEN_MIT_URL ? { name: env.OEFFNEN_MIT_NAME, url: env.OEFFNEN_MIT_URL } : undefined,
  importOrdner: env.IMPORT_ORDNER,
  importMax: env.IMPORT_MAX_GB * 1024 ** 3,
  mail: mailAusEnv(env),
  oberflaeche,
});

// Große Anfragen nur für den Export aus Paperless-ngx; alle anderen begrenzt die App selbst (server/app.ts)
Bun.serve({
  port: env.PORT,
  fetch: (req, server) => {
    verbindungen.set(req, server.requestIP(req)?.address);
    return app.fetch(req);
  },
  maxRequestBodySize: Math.max(110 * 1024 * 1024, env.IMPORT_MAX_GB * 1024 ** 3 + 1024 * 1024),
});
console.log(`Belegt läuft auf Port ${env.PORT}`);
