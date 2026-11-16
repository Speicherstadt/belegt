import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * server/start.sh, der Start im Image: Mit MIGRATION_DATABASE_URL läuft erst der Migrationsschritt, und der Server
 * bekommt die Eigentümeradresse nicht mehr. Ein nachgebautes bun schreibt auf, womit es aufgerufen wurde.
 */
function starten(env: Record<string, string>) {
  const ordner = mkdtempSync(join(tmpdir(), "belegt-start-"));
  const protokoll = join(ordner, "aufrufe");
  writeFileSync(
    join(ordner, "bun"),
    `#!/bin/sh\necho "$* MIGRATION=[\${MIGRATION_DATABASE_URL-unset}]" >> "${protokoll}"\n`,
  );
  chmodSync(join(ordner, "bun"), 0o755);
  const r = spawnSync("sh", [join(import.meta.dirname, "start.sh")], {
    env: { PATH: `${ordner}:/usr/bin:/bin`, ...env },
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(protokoll, "utf8").trim().split("\n");
}

describe("Start im Image (server/start.sh)", () => {
  it("migriert mit MIGRATION_DATABASE_URL zuerst und startet den Server ohne sie", () => {
    expect(starten({ MIGRATION_DATABASE_URL: "postgres://belegt:geheim@db/belegt" })).toEqual([
      "server/migrieren.ts MIGRATION=[postgres://belegt:geheim@db/belegt]",
      "server/index.ts MIGRATION=[]",
    ]);
  });

  it("startet ohne MIGRATION_DATABASE_URL gleich den Server, der dann selbst migriert", () => {
    expect(starten({})).toEqual(["server/index.ts MIGRATION=[unset]"]);
  });
});
