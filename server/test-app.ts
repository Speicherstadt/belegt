import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { createApp } from "./app.ts";
import { createAuth, type OidcKonfig } from "./auth.ts";
import type { AppUmgebung } from "./http/gemeinsam.ts";
import { testDatenbank } from "./test-db.ts";

const BASIS = "http://localhost:3000";
export const EINRICHTUNGSCODE = "test-einrichtungscode";

/** App mit echter Anmeldung, eigener Testdatenbank und eigenem Speicher; für Tests gegen Postgres */
export async function testApp({
  begrenzen = false,
  oeffnen,
  oauth,
  abfragen,
  oidc,
  embedOrigin,
  oeffnenMit,
}: Pick<AppUmgebung, "oeffnen" | "oauth" | "abfragen" | "embedOrigin" | "oeffnenMit"> & {
  begrenzen?: boolean;
  oidc?: OidcKonfig;
} = {}) {
  const sql: postgres.Sql = await testDatenbank();
  const verzeichnis = await mkdtemp(join(tmpdir(), "belegt-test-"));
  const db = drizzle(sql);
  const speicher = dateispeicher({ verzeichnis: () => verzeichnis });
  const auth = createAuth({
    db,
    secret: "x".repeat(32),
    baseURL: BASIS,
    einrichtungscode: EINRICHTUNGSCODE,
    begrenzen,
    oidc,
  });
  const schluessel = randomBytes(32);
  const app = createApp({
    db,
    speicher,
    auth,
    schluessel,
    oeffnen,
    oeffnenMit,
    oauth,
    abfragen,
    oidcName: oidc?.name,
    embedOrigin,
  });

  /** Anfrage wie aus dem Browser, mit Origin für die CSRF-Prüfung von Better Auth */
  const anfrage = (pfad: string, init: RequestInit = {}, cookie?: string) =>
    app.request(`${BASIS}${pfad}`, {
      ...init,
      headers: {
        origin: BASIS,
        ...(cookie ? { cookie } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  /** Registriert ein Konto (mit Einrichtungscode oder Einladung) und gibt das Cookie der Sitzung zurück */
  async function registrieren(
    email: string,
    passwort = "ein-langes-passwort",
    kopf: Record<string, string> = { "x-belegt-einrichtungscode": EINRICHTUNGSCODE },
  ) {
    const res = await anfrage("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...kopf },
      body: JSON.stringify({ email, password: passwort, name: email }),
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { res, cookie };
  }

  async function aufraeumen() {
    await sql.end();
    await rm(verzeichnis, { recursive: true, force: true });
  }

  return { sql, db, speicher, schluessel, app, anfrage, registrieren, aufraeumen };
}
