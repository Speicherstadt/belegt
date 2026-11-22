import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";

/*
 * Rechte dürfen die Liste nicht bremsen (bei Paperless-ngx lud für Nutzer ohne Superadmin alles langsam, weil die
 * Rechte je Dokument nachgerechnet wurden). Bei uns ist die Sicht eine SQL-Bedingung in derselben Abfrage
 * (server/zugang/sicht.ts). Der Test misst: Ein Mitarbeiter mit Sichtbereich bekommt seine Liste kaum langsamer als der
 * Inhaber, bei einigen hundert Dokumenten.
 */

const ANZAHL = 300;
const LAEUFE = 7;

const median = (werte: number[]) => [...werte].sort((a, b) => a - b)[Math.floor(werte.length / 2)]!;

describe.skipIf(!testDatenbankUrl)("Sicht bremst die Liste nicht", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let mitarbeiter: string;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, inhaber);
    const json = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const rot = ((await (await als("/api/tags", json({ name: "Rot" }))).json()) as { id: string }).id;
    const ids: string[] = [];
    for (let i = 0; i < ANZAHL; i++) {
      const f = new FormData();
      f.append("datei", new File([`Dokument ${i}`], `dok-${i}.txt`));
      ids.push(((await (await als("/api/dokumente", { method: "POST", body: f })).json()) as { id: string }).id);
    }
    const sammeln = await als(
      "/api/dokumente/sammeln",
      json({ ids: ids.filter((_, i) => i % 2 === 0), tagsHinzu: [rot], tagsWeg: [], felder: [] }),
    );
    expect(sammeln.status).toBe(200);
    mitarbeiter = await zugangAnlegen(t, inhaber, "mia@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [rot] },
    });
  }, 120_000);
  afterAll(() => t?.aufraeumen());

  async function messen(cookie: string) {
    const zeiten: number[] = [];
    let gesamt = 0;
    for (let i = 0; i < LAEUFE; i++) {
      const start = performance.now();
      const res = await t.anfrage("/api/dokumente?proSeite=100", {}, cookie);
      gesamt = Number(res.headers.get("x-gesamt"));
      await res.json();
      zeiten.push(performance.now() - start);
    }
    return { ms: median(zeiten), gesamt };
  }

  it("ein Mitarbeiter sieht nur seinen Bereich und wartet darauf nicht viel länger als der Inhaber", async () => {
    await messen(inhaber); // aufwärmen
    const chef = await messen(inhaber);
    const mia = await messen(mitarbeiter);
    expect(chef.gesamt).toBe(ANZAHL);
    expect(mia.gesamt).toBe(ANZAHL / 2);
    // Großzügig, damit langsame CI-Rechner nicht rot werden; eine Auswertung je Dokument wäre ein Vielfaches
    expect(mia.ms).toBeLessThan(chef.ms * 3 + 100);
  }, 60_000);
});
