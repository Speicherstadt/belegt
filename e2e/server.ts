import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import postgres from "postgres";
import { createApp } from "../server/app.ts";
import { createAuth } from "../server/auth.ts";
import { verbinden } from "../server/db/client.ts";
import { migrieren } from "../server/db/migrieren.ts";

/*
 * Server für die E2E-Tests: frische Datenbank neben E2E_DATABASE_URL (sie wird gelöscht und neu angelegt, nie auf echte
 * Daten zeigen lassen), eigener Speicher, eigener Port. Playwright startet ihn vor den Tests.
 */
const basis = process.env.E2E_DATABASE_URL ?? "postgres://belegt:belegt@localhost:5432/belegt_e2e";
const port = Number(process.env.E2E_SERVER_PORT ?? 3185);
const url = new URL(basis);
const name = decodeURIComponent(url.pathname.slice(1));

const adminUrl = new URL(basis);
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
await admin`drop database if exists ${admin(name)} with (force)`;
await admin`create database ${admin(name)}`;
await admin.end();

await migrieren(basis);
const { db } = verbinden(basis);
const verzeichnis = mkdtempSync(join(tmpdir(), "belegt-e2e-"));
const speicher = dateispeicher({ verzeichnis: () => verzeichnis });
const auth = createAuth({ db, secret: "e2e-".repeat(8), baseURL: process.env.E2E_APP_URL ?? "http://localhost:5185" });
Bun.serve({ port, fetch: createApp({ db, speicher, auth }).fetch, maxRequestBodySize: 110 * 1024 * 1024 });
console.log(`E2E-Server auf Port ${port}`);
