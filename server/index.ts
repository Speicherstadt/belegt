import { randomBytes } from "node:crypto";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { schluesselAus } from "./crypto.ts";
import { verbinden } from "./db/client.ts";
import { migrieren } from "./db/migrieren.ts";
import { eingerichtet } from "./db/status.ts";
import { readEnv } from "./env.ts";
import { imapOeffnen } from "./mail/imapflow.ts";

const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET fehlt (mindestens 32 Zeichen)");

await migrieren(env.DATABASE_URL);
const { db } = verbinden(env.DATABASE_URL);
const speicher = dateispeicher({ verzeichnis: () => env.DOCUMENTS_DIR });
// Einrichtungscode für das erste Konto: bei jedem Start neu, nur im Log
const einrichtungscode = randomBytes(9).toString("base64url");
if (!(await eingerichtet(db))) console.log(`Belegt ist noch nicht eingerichtet. Einrichtungscode: ${einrichtungscode}`);
const auth = createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, einrichtungscode });
const schluessel = env.BELEGT_SCHLUESSEL ? schluesselAus(env.BELEGT_SCHLUESSEL) : undefined;
const app = createApp({ db, speicher, auth, schluessel, oeffnen: imapOeffnen, abrufMinuten: env.ABRUF_MINUTEN });

Bun.serve({ port: env.PORT, fetch: app.fetch, maxRequestBodySize: 110 * 1024 * 1024 });
console.log(`Belegt läuft auf Port ${env.PORT}`);
