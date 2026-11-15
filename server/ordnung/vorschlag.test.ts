import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kiVorschlaegeErzeugen } from "../ki/vorschlaege.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const mail = (betreff: string, id: string) =>
  [
    "From: Abrechnung <rechnung@versorger.example>",
    "To: anna@example.org",
    `Subject: ${betreff}`,
    `Message-ID: <${id}@versorger.example>`,
    "",
    "Ihre Rechnung liegt bei.",
    "",
  ].join("\r\n");

describe.skipIf(!testDatenbankUrl)("Vorschläge für Tags, Dokumenttyp und Felder gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const anlegen = async (pfad: string, body: object) =>
    ((await (await als(pfad, json(body))).json()) as { id: string }).id;
  const importieren = async (inhalt: string) => {
    const f = new FormData();
    f.append("datei", new File([inhalt], "m.eml"));
    return ((await (await als("/api/mails", { method: "POST", body: f })).json()) as { neu: string[] }).neu[0]!;
  };

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("eine Regel schlägt zusätzlich Tags, Dokumenttyp und Feldwerte vor; übernehmen setzt sie", async () => {
    const energie = await anlegen("/api/tags", { name: "Energie", farbe: "gelb" });
    const fix = await anlegen("/api/tags", { name: "Fixkosten" });
    const typ = await anlegen("/api/dokumenttypen", { name: "Rechnung", vorgabeArt: "beleg" });
    const summe = await anlegen("/api/felder", { name: "Abschlag", typ: "betrag" });
    const res = await als(
      "/api/regeln",
      json({
        name: "Versorger",
        wenn: { domain: "versorger.example" },
        dann: "beleg",
        ordnung: { tags: [energie, fix], dokumenttyp: typ, felder: [{ feldId: summe, wert: "1.234,56" }] },
      }),
    );
    expect(res.status).toBe(201);
    const id = await importieren(mail("Rechnung November", "r1"));
    const { vorschlag } = await (await als(`/api/dokumente/${id}/vorschlag`)).json();
    expect(vorschlag).toMatchObject({ art: "beleg", regel: { name: "Versorger" } });
    expect(vorschlag.ordnung.tags.map((x: { name: string }) => x.name).sort()).toEqual(["Energie", "Fixkosten"]);
    expect(vorschlag.ordnung.dokumenttyp).toEqual({ id: typ, name: "Rechnung" });
    expect(vorschlag.ordnung.felder).toEqual([{ feldId: summe, name: "Abschlag", typ: "betrag", wert: 123456 }]);
    const regeln = await (await als("/api/regeln")).json();
    expect(regeln[0].ordnung.dokumenttyp.name).toBe("Rechnung");

    // Übernehmen: die Oberfläche setzt den Vorschlag über die Schnittstelle des Dokuments
    const o = vorschlag.ordnung;
    const gesetzt = await (
      await als(
        `/api/dokumente/${id}/ordnung`,
        json({
          tagsHinzu: o.tags.map((x: { id: string }) => x.id),
          dokumenttyp: o.dokumenttyp.id,
          felder: o.felder.map((f: { feldId: string; wert: number }) => ({ feldId: f.feldId, wert: f.wert })),
        }),
      )
    ).json();
    expect(gesetzt.tags).toHaveLength(2);
    expect(gesetzt.felder[0].wert).toBe(123456);

    // Was seitdem gelöscht wurde, schlägt die Regel nicht mehr vor
    await als(`/api/tags/${fix}`, { method: "DELETE" });
    const danach = (await (await als(`/api/dokumente/${id}/vorschlag`)).json()).vorschlag;
    expect(danach.ordnung.tags.map((x: { name: string }) => x.name)).toEqual(["Energie"]);
  });

  it("lehnt eine Regel mit unbekanntem Tag (409) oder unpassendem Wert (400) ab", async () => {
    const summe = await anlegen("/api/felder", { name: "Regelsumme", typ: "betrag" });
    const regel = (ordnung: object) =>
      als("/api/regeln", json({ name: "X", wenn: { domain: "x.example" }, dann: "beleg", ordnung }));
    expect((await regel({ tags: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(409);
    expect((await regel({ felder: [{ feldId: summe, wert: "zwölf" }] })).status).toBe(400);
    expect((await regel({})).status).toBe(201);
  });

  it("das Sprachmodell wählt nur aus vorhandenen Tags und Dokumenttypen", async () => {
    await anlegen("/api/tags", { name: "Strom" });
    await anlegen("/api/dokumenttypen", { name: "Abrechnung" });
    const id = await importieren(mail("Jahresabrechnung", "ki1"));
    const anfragen: string[] = [];
    const abfragen = async (_url: string, init: RequestInit) => {
      anfragen.push(String(init.body));
      return Response.json({
        message: {
          content: JSON.stringify({
            art: "beleg",
            entstanden: null,
            titel: "Jahresabrechnung",
            korrespondent: "Versorger",
            begruendung: "Abrechnung",
            dokumenttyp: "abrechnung",
            tags: ["strom", "Erfunden"],
          }),
        },
      });
    };
    // Auch die Mail aus dem ersten Test liegt noch im Eingang
    expect((await kiVorschlaegeErzeugen(t.db, { url: "http://ollama:11434", modell: "m" }, { abfragen })).erzeugt).toBe(
      2,
    );
    const format = JSON.parse(anfragen[0]!).format;
    expect(format.properties.tags.items.enum).toContain("Strom");
    expect(format.properties.dokumenttyp.enum).toContain("Abrechnung");
    const { ki } = await (await als(`/api/dokumente/${id}/vorschlag`)).json();
    expect(ki.ordnung.tags.map((x: { name: string }) => x.name)).toEqual(["Strom"]);
    expect(ki.ordnung.dokumenttyp.name).toBe("Abrechnung");
  });

  it("eine Regel ohne Art schlägt nur Tags, Dokumenttyp und Feldwerte vor", async () => {
    const reise = await anlegen("/api/tags", { name: "Reise" });
    const ort = await anlegen("/api/felder", { name: "Ort", typ: "text" });
    const km = await anlegen("/api/felder", { name: "Kilometer", typ: "zahl" });
    const res = await als(
      "/api/regeln",
      json({
        name: "Nur taggen",
        wenn: { betreffEnthaelt: "Bahnticket" },
        dann: null,
        reihenfolge: 0,
        ordnung: {
          tags: [reise],
          felder: [
            { feldId: ort, wert: "Berlin" },
            { feldId: km, wert: 600 },
          ],
        },
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).art).toBeNull();
    // Ein anderer Absender, sonst gewänne die Regel „Versorger“ aus dem ersten Test
    const id = await importieren(mail("Ihr Bahnticket", "bahn1").replace("versorger.example>", "bahn.example>"));
    const { vorschlag } = await (await als(`/api/dokumente/${id}/vorschlag`)).json();
    expect(vorschlag).toMatchObject({ art: null, regel: { name: "Nur taggen" } });
    expect(vorschlag.ordnung.tags.map((x: { name: string }) => x.name)).toEqual(["Reise"]);
    expect(vorschlag.ordnung.felder.map((f: { wert: unknown }) => f.wert)).toEqual(["Berlin", 600]);

    // Ohne Art und ohne Ordnung schlägt eine Regel nichts vor: die Schnittstelle und Postgres lehnen sie ab
    const leer = (dann: unknown, ordnung?: object) =>
      als("/api/regeln", json({ name: "Leer", wenn: { domain: "leer.example" }, dann, ordnung }));
    expect((await leer(null)).status).toBe(400);
    expect((await leer(null, { tags: [] })).status).toBe(400);
    await expect(
      t.sql`insert into regeln (name, bedingung, art) values ('Leer', '{"domain":"leer.example"}', null)`,
    ).rejects.toThrow(/regeln_art_oder_ordnung/);
    await expect(
      t.sql`insert into regeln (name, bedingung, art, ordnung)
            values ('Leer', '{"domain":"leer.example"}', null, '{"tags":[],"dokumenttyp":null,"felder":[]}')`,
    ).rejects.toThrow(/regeln_art_oder_ordnung/);

    // Ist alles Vorgeschlagene inzwischen gelöscht, bleibt nichts zum Vorschlagen
    await als(`/api/tags/${reise}`, { method: "DELETE" });
    await als(`/api/felder/${ort}`, { method: "DELETE" });
    await als(`/api/felder/${km}`, { method: "DELETE" });
    expect((await (await als(`/api/dokumente/${id}/vorschlag`)).json()).vorschlag).toBeNull();
  });
});
