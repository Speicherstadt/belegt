import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import type { Start } from "./start.ts";

describe.skipIf(!testDatenbankUrl)("Startseite: Verlauf, Vorjahr und Datenträger gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let pruefer: string;
  const start = async (cookie: string) => (await (await t.anfrage("/api/start", {}, cookie)).json()) as Start;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    pruefer = await zugangAnlegen(t, inhaber, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
    for (const name of ["a.txt", "b.txt"]) {
      const f = new FormData();
      f.append("datei", new File([name], name));
      await t.anfrage("/api/dokumente", { method: "POST", body: f }, inhaber);
    }
  });
  afterAll(() => t?.aufraeumen());

  it("zählt die Eingänge der letzten zwölf Monate, den laufenden zuletzt, und das Vorjahr bis heute", async () => {
    const s = await start(inhaber);
    expect(s.verlauf).toHaveLength(12);
    expect(s.verlauf.at(-1)).toBe(2);
    expect(s.verlauf.slice(0, 11).every((n) => n === 0)).toBe(true);
    expect(s.vorjahr).toBe(0);
  });

  it("nennt Größe und freien Platz des Datenträgers mit den Originalen, nur wer den Speicher sieht", async () => {
    const s = await start(inhaber);
    expect(s.speicher?.datentraeger?.gesamt).toBeGreaterThan(0);
    expect(s.speicher?.datentraeger?.frei).toBeGreaterThan(0);
    expect(s.speicher?.datentraeger?.frei).toBeLessThanOrEqual(s.speicher?.datentraeger?.gesamt ?? 0);
    const p = await start(pruefer);
    expect(p.speicher).toBeUndefined();
    expect(p.verlauf).toHaveLength(12);
  });
});
