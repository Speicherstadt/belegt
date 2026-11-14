import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { migrieren } from "./db/migrieren.ts";
import { eingerichtet } from "./db/status.ts";
import { readEnv } from "./env.ts";
import { imapOeffnen } from "./mail/imapflow.ts";
import { oauthAusEnv } from "./mail/oauth.ts";
import { speicherAusEnv } from "./speicher/auswahl.ts";

const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET fehlt (mindestens 32 Zeichen)");

await migrieren(env.DATABASE_URL);
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
const app = createApp({
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
  eingangsordner: !!env.EINGANG_ORDNER,
  trennblattCode: env.TRENNBLATT_CODE,
  kiModell: env.KI_URL && env.KI_MODELL ? { modell: env.KI_MODELL, host: new URL(env.KI_URL).host } : undefined,
  oeffnenMit:
    env.OEFFNEN_MIT_NAME && env.OEFFNEN_MIT_URL ? { name: env.OEFFNEN_MIT_NAME, url: env.OEFFNEN_MIT_URL } : undefined,
  oberflaeche,
});

Bun.serve({ port: env.PORT, fetch: app.fetch, maxRequestBodySize: 110 * 1024 * 1024 });
console.log(`Belegt läuft auf Port ${env.PORT}`);
