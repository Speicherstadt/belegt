import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";

describe.skipIf(!testDatenbankUrl)("Fristvorschau gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const vorschau = (abfrage: Record<string, string>, cookie = inhaber) =>
    t.anfrage(`/api/fristen/vorschau?${new URLSearchParams(abfrage)}`, {}, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("rechnet die gesetzliche Frist; Institute unter Aufsicht zehn Jahre", async () => {
    const res = await vorschau({ art: "beleg", entstanden: "2026-03-12" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bis: "2034-12-31", grund: "gesetz", jahre: 8, gesperrt: false });
    await t.sql`update einstellungen set aufsicht = true where id = 1`;
    try {
      expect(await (await vorschau({ art: "beleg", entstanden: "2026-03-12" })).json()).toEqual({
        bis: "2036-12-31",
        grund: "gesetz",
        jahre: 10,
        gesperrt: false,
      });
    } finally {
      await t.sql`update einstellungen set aufsicht = false where id = 1`;
    }
  });

  it("nimmt bei freiwillig das gewählte Datum (leeres Feld bei anderen Arten zählt als fehlend) und bei frei keine Frist", async () => {
    expect(
      await (await vorschau({ art: "freiwillig", entstanden: "2026-03-12", freiwilligBis: "2030-06-30" })).json(),
    ).toEqual({ bis: "2030-06-30", grund: "freiwillig", jahre: null, gesperrt: false });
    expect(await (await vorschau({ art: "frei", entstanden: "2026-03-12", freiwilligBis: "" })).json()).toEqual({
      bis: null,
      grund: "keine",
      jahre: null,
      gesperrt: false,
    });
  });

  it.each([
    [{ art: "freiwillig", entstanden: "2026-03-12" }, "Freiwillige Aufbewahrung braucht ein Datum, bis wann"],
    [
      { art: "freiwillig", entstanden: "2026-03-12", freiwilligBis: "" },
      "Freiwillige Aufbewahrung braucht ein Datum, bis wann",
    ],
    [
      { art: "freiwillig", entstanden: "2026-03-12", freiwilligBis: "2026-03-11" },
      "Das Datum liegt vor der Entstehung der Unterlage",
    ],
    [{ art: "beleg", entstanden: "2026-02-30" }, "Den Tag 2026-02-30 gibt es nicht"],
    [{ art: "beleg", entstanden: "0000-01-01" }, "Das Datum 0000-01-01 ist zu früh: Belegt nimmt Jahre ab 1000 an"],
    [{ art: "buecher", entstanden: "9999-06-01" }, "Das Datum liegt zu weit in der Zukunft: Belegt rechnet bis 9999"],
    [{ art: "frei", entstanden: "0001-01-01" }, "Das Datum 0001-01-01 ist zu früh: Belegt nimmt Jahre ab 1000 an"],
    [{ art: "xyz", entstanden: "2026-03-12" }, "Die Art fehlt oder ist unbekannt"],
    [{ art: "beleg" }, "Das Datum der Entstehung fehlt oder hat nicht das Format JJJJ-MM-TT"],
    [{ art: "beleg", entstanden: "12.03.2026" }, "Das Datum der Entstehung fehlt oder hat nicht das Format JJJJ-MM-TT"],
    [
      { art: "freiwillig", entstanden: "2026-03-12", freiwilligBis: "morgen" },
      "Das Datum „bis wann“ hat nicht das Format JJJJ-MM-TT",
    ],
  ])("lehnt %j mit 400 und verständlicher Meldung ab", async (abfrage, meldung) => {
    const res = await vorschau(abfrage);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fehler: string }).fehler).toBe(meldung);
  });

  it("meldet eine offene Sperre über dem Entstehungstag, nicht daneben und nicht nach dem Aufheben", async () => {
    const sperre = (await (
      await t.anfrage("/api/sperren", json({ grund: "Prüfung", von: "2026-01-01", bis: "2026-12-31" }), inhaber)
    ).json()) as { id: string };
    const gesperrt = async (entstanden: string) =>
      ((await (await vorschau({ art: "beleg", entstanden })).json()) as { gesperrt: boolean }).gesperrt;
    expect(await gesperrt("2026-03-12")).toBe(true);
    expect(await gesperrt("2026-12-31")).toBe(true); // `bis` gilt einschließlich
    expect(await gesperrt("2027-01-01")).toBe(false);
    await t.anfrage(`/api/sperren/${sperre.id}/aufheben`, { method: "POST" }, inhaber);
    expect(await gesperrt("2026-03-12")).toBe(false);
  });

  it("Mitarbeiter mit bearbeiten bekommt die Frist ohne gesperrt, mit lesen 403, ein Token mit lesen 200 ohne gesperrt", async () => {
    await t.anfrage("/api/sperren", json({ grund: "Prüfung", von: "2026-01-01", bis: "2026-12-31" }), inhaber);
    const bereich = { tags: [] };
    const bearbeiter = await zugangAnlegen(t, inhaber, "bearbeiter@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: bereich,
    });
    const leser = await zugangAnlegen(t, inhaber, "leser@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: bereich,
    });
    const abfrage = { art: "beleg", entstanden: "2026-03-12" };
    const res = await vorschau(abfrage, bearbeiter);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bis: "2034-12-31", grund: "gesetz", jahre: 8 });
    expect((await vorschau(abfrage, leser)).status).toBe(403);
    const token = await tokenAnlegen(t, inhaber, "lesen");
    const mitToken = await t.anfrage(`/api/fristen/vorschau?${new URLSearchParams(abfrage)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mitToken.status).toBe(200);
    // Tokens dürfen Sperren nicht lesen (tokenDarf): auch dann kein `gesperrt`, wenn eine offene Sperre greift
    expect(await mitToken.json()).toEqual({ bis: "2034-12-31", grund: "gesetz", jahre: 8 });
    // Ein Token mit schreiben hat intern die Rolle Inhaber, darf Sperren aber ebenso wenig sehen
    const schreibToken = await tokenAnlegen(t, inhaber, "schreiben");
    const mitSchreibToken = await t.anfrage(`/api/fristen/vorschau?${new URLSearchParams(abfrage)}`, {
      headers: { authorization: `Bearer ${schreibToken}` },
    });
    expect(mitSchreibToken.status).toBe(200);
    expect(await mitSchreibToken.json()).toEqual({ bis: "2034-12-31", grund: "gesetz", jahre: 8 });
    // Steuerberatung sieht Sperren; Prüfer und nicht Angemeldete kommen nicht an die Route
    const beratung = await zugangAnlegen(t, inhaber, "beratung@example.org", { rolle: "steuerberatung" });
    expect(await (await vorschau(abfrage, beratung)).json()).toMatchObject({ gesperrt: true });
    const pruefer = await zugangAnlegen(t, inhaber, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2026-01-01", bis: "2026-12-31" },
    });
    expect((await vorschau(abfrage, pruefer)).status).toBe(403);
    expect((await t.anfrage(`/api/fristen/vorschau?${new URLSearchParams(abfrage)}`, {})).status).toBe(401);
  });
});
