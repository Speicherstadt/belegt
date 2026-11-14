import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { createApp } from "./app.ts";
import { verbinden } from "./db/client.ts";
import { migrieren } from "./db/migrieren.ts";
import { readEnv } from "./env.ts";

const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");

await migrieren(env.DATABASE_URL);
const { db } = verbinden(env.DATABASE_URL);
const speicher = dateispeicher({ verzeichnis: () => env.DOCUMENTS_DIR });
const app = createApp({ db, speicher });

Bun.serve({ port: env.PORT, fetch: app.fetch, maxRequestBodySize: 110 * 1024 * 1024 });
console.log(`Belegt läuft auf Port ${env.PORT}`);
