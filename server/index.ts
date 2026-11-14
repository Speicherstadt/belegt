import { createApp } from "./app.ts";
import { readEnv } from "./env.ts";

const env = readEnv();
const app = createApp();

Bun.serve({ port: env.PORT, fetch: app.fetch });
console.log(`Belegt läuft auf Port ${env.PORT}`);
