import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

describe("Oberfläche ausliefern", () => {
  const ordner = mkdtempSync(join(tmpdir(), "belegt-dist-"));
  const dist = join(ordner, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Belegt</title>");
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(ordner, "geheim.txt"), "nicht ausliefern");
  afterAll(() => rmSync(ordner, { recursive: true, force: true }));

  // Ohne Datenbank: die Routen hier fragen sie nicht an
  const app = createApp({
    db: {} as never,
    speicher: {} as never,
    auth: { options: { baseURL: "http://x" }, api: { getSession: async () => null } } as never,
    oberflaeche: dist,
  });

  it("liefert Dateien mit Typ und langem Cache für assets/", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("öffnet für Adressen der App die index.html, auch beim Neuladen", async () => {
    for (const pfad of ["/", "/archiv", "/dokumente/1234"]) {
      const res = await app.request(pfad);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>Belegt</title>");
    }
  });

  it("liefert nichts außerhalb von dist und lässt /api beim Server", async () => {
    for (const pfad of ["/../geheim.txt", "/%2e%2e/geheim.txt", "/assets/..%2f..%2fgeheim.txt", "/fehlt.js"]) {
      const res = await app.request(pfad);
      expect(await res.text()).not.toContain("nicht ausliefern");
      expect(res.status).toBe(404);
    }
    expect((await app.request("/api/dokumente")).status).toBe(401);
    expect((await app.request("/api/gibt-es-nicht")).status).toBe(401);
  });
});
