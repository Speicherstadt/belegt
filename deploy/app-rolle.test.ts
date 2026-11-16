/**
 * Das Init-Skript für Postgres (configs.app-rolle in compose.yml und deploy/compose.yml) legt die App-Rolle an. Das
 * Passwort darf dabei nicht auf der Befehlszeile von psql stehen: Die sieht jeder auf dem Rechner mit ps, auch außerhalb
 * des Containers. Der Test führt das Skript mit dem echten psql gegen den Test-Postgres aus, über eine Attrappe, die die
 * Argumente mitschreibt.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatenbank, testDatenbankUrl } from "../server/test-db.ts";

const wurzel = join(import.meta.dirname, "..");
const psql = spawnSync("sh", ["-c", "command -v psql"], { encoding: "utf8" }).stdout.trim();

/** Inhalt von configs.app-rolle, mit $$ wie nach der Ersetzung durch Compose */
function skript(datei: string): string {
  const text = readFileSync(join(wurzel, datei), "utf8");
  const anfang = "\n  app-rolle:\n    content: |\n";
  expect(text).toContain(anfang);
  const zeilen = text.slice(text.indexOf(anfang) + anfang.length).split("\n");
  const ende = zeilen.findIndex((z) => z !== "" && !z.startsWith("      "));
  return zeilen
    .slice(0, ende)
    .map((z) => z.slice(6))
    .join("\n")
    .replaceAll("$$", "$");
}

describe.skipIf(!testDatenbankUrl || !psql)("Init-Skript der App-Rolle (Postgres)", () => {
  const ordner = mkdtempSync(join(tmpdir(), "belegt-app-rolle-"));
  const u = new URL(testDatenbankUrl ?? "postgres://x@localhost/x");
  const passwort = "init-geheim-passwort";
  let admin: postgres.Sql;

  beforeAll(async () => {
    admin = await testDatenbank();
  });

  afterAll(async () => {
    rmSync(ordner, { recursive: true, force: true });
    if (!admin) return;
    await admin`drop role if exists belegt_app`;
    await admin.end();
  });

  it.each(["compose.yml", "deploy/compose.yml"])(
    "legt in %s die Rolle an, ohne das Passwort in den Argumenten",
    async (datei) => {
      await admin`drop role if exists belegt_app`;
      const argumente = join(ordner, "argumente");
      const attrappe = join(ordner, "psql");
      writeFileSync(attrappe, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argumente}"\nexec "${psql}" "$@"\n`);
      chmodSync(attrappe, 0o755);
      writeFileSync(argumente, "");
      const r = spawnSync("bash", ["-c", skript(datei)], {
        encoding: "utf8",
        env: {
          PATH: `${ordner}:${process.env.PATH}`,
          PGHOST: u.hostname,
          PGPORT: u.port || "5432",
          POSTGRES_USER: decodeURIComponent(u.username),
          POSTGRES_DB: decodeURIComponent(u.pathname.slice(1)),
          BELEGT_APP_PASSWORT: passwort,
        },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(argumente, "utf8")).not.toContain(passwort);
      const anmeldung = new URL(testDatenbankUrl!);
      anmeldung.username = "belegt_app";
      anmeldung.password = passwort;
      const app = postgres(anmeldung.toString(), { max: 1, onnotice: () => {} });
      try {
        expect(await app`select current_user as rolle`).toEqual([{ rolle: "belegt_app" }]);
      } finally {
        await app.end();
        await admin`drop role if exists belegt_app`;
      }
    },
  );
});
