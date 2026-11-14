import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { openapi } from "./openapi.ts";

describe("OpenAPI", () => {
  it("beschreibt nur Pfade, die es als Route gibt", async () => {
    // Routen entstehen erst mit Umgebung; die Datenbank wird dafür nicht angefragt
    const app = createApp({
      db: {} as never,
      speicher: {} as never,
      auth: { options: { baseURL: "http://x" } } as never,
    });
    const routen = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    for (const [pfad, methoden] of Object.entries(openapi.paths)) {
      for (const methode of Object.keys(methoden)) {
        expect(routen, `${methode} ${pfad}`).toContain(`${methode.toUpperCase()} ${pfad.replace(/\{(\w+)\}/g, ":$1")}`);
      }
    }
  });
});

describe.skipIf(!testDatenbankUrl)("OpenAPI ausgeliefert", () => {
  it("liegt ohne Anmeldung unter /api/openapi.json", async () => {
    const t = await testApp();
    try {
      const res = await t.app.request("/api/openapi.json");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ openapi: "3.1.0", info: { title: "Belegt" } });
    } finally {
      await t.aufraeumen();
    }
  });
});
