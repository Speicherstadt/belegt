import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { verbinden } from "./db/client.ts";
import { migrieren } from "./db/migrieren.ts";
import { readEnv } from "./env.ts";

const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET fehlt (mindestens 32 Zeichen)");

await migrieren(env.DATABASE_URL);
const { db } = verbinden(env.DATABASE_URL);
const speicher = dateispeicher({ verzeichnis: () => env.DOCUMENTS_DIR });
const auth = createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL });
const app = createApp({ db, speicher, auth });

Bun.serve({ port: env.PORT, fetch: app.fetch, maxRequestBodySize: 110 * 1024 * 1024 });
console.log(`Belegt läuft auf Port ${env.PORT}`);
