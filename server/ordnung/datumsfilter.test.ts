import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Archiv nach Datum filtern gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const hoch = async (name: string, entstanden?: string) => {
    const f = new FormData();
    f.append("datei", new File([name], name));
    const { id } = (await (await anfrage("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
    if (entstanden) {
      const res = await anfrage(`/api/dokumente/${id}/einordnung`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ art: "frei", entstanden }),
      });
      expect(res.status).toBe(201);
    }
    return id;
  };
  const liste = async (abfrage: string) =>
    ((await (await anfrage(`/api/dokumente?${abfrage}`)).json()) as { dateiname: string }[])
      .map((d) => d.dateiname)
      .sort();

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    await hoch("januar.pdf", "2026-01-15");
    await hoch("maerz.pdf", "2026-03-31");
    await hoch("vorjahr.pdf", "2025-12-31");
  });
  afterAll(() => t?.aufraeumen());

  it("filtert nach dem Tag der Entstehung, Grenzen eingeschlossen", async () => {
    expect(await liste("entstandenVon=2026-01-01")).toEqual(["januar.pdf", "maerz.pdf"]);
    expect(await liste("entstandenBis=2026-01-15")).toEqual(["januar.pdf", "vorjahr.pdf"]);
    expect(await liste("entstandenVon=2026-01-16&entstandenBis=2026-03-31")).toEqual(["maerz.pdf"]);
  });

  it("filtert nach dem Tag des Eingangs", async () => {
    // Eingegangen sind alle heute; dokumente ist versiegelt, ein anderer Tag lässt sich nicht unterschieben
    const heute = new Date().toISOString().slice(0, 10);
    expect(await liste(`eingegangenVon=${heute}`)).toEqual(["januar.pdf", "maerz.pdf", "vorjahr.pdf"]);
    expect(await liste("eingegangenBis=2020-01-01")).toEqual([]);
  });

  it("lehnt ungültige Daten und verdrehte Grenzen ab", async () => {
    expect((await anfrage("/api/dokumente?entstandenVon=gestern")).status).toBe(400);
    expect((await anfrage("/api/dokumente?eingegangenBis=2026-13-01")).status).toBe(400);
    expect((await anfrage("/api/dokumente?entstandenVon=2026-02-01&entstandenBis=2026-01-01")).status).toBe(400);
  });
});
