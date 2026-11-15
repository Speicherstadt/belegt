import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zuordnungVorschlaegeErzeugen } from "./vorschlaege.ts";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type Vorschlag = {
  zuordnung: {
    korrespondent: { id: string; name: string } | null;
    dokumenttyp: { id: string; name: string } | null;
    tags: { id: string; name: string }[];
    uebersprungen: string[];
  } | null;
};

describe.skipIf(!testDatenbankUrl)("Zuordnungsregeln gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const hoch = async (inhalt: string, name: string) => {
    const f = new FormData();
    f.append("datei", new File([inhalt], name, { type: "text/plain" }));
    return (await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
  };
  const anlegen = async (pfad: string, body: object) => {
    const res = await als(inhaber)(pfad, json(body));
    expect(res.status, JSON.stringify(body)).toBe(201);
    return (await res.json()) as { id: string };
  };
  const vorschlag = async (id: string) =>
    (await (await als(inhaber)(`/api/dokumente/${id}/vorschlag`)).json()) as Vorschlag;
  /** Was der Worker nach dem Eingang tut: Text lesen, dann die Zuordnungsregeln */
  const worker = async () => {
    await inhalteErzeugen(t, { ocr: false });
    return zuordnungVorschlaegeErzeugen(t.db, { ocr: false });
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("Zuordnungsregeln schlagen Korrespondent, Dokumenttyp und Tags vor, sobald der Text gelesen ist", async () => {
    const tel = await anlegen("/api/korrespondenten", {
      name: "Telekom",
      abgleich: "irgendein_wort",
      abgleichText: "telekom magenta",
    });
    await anlegen("/api/korrespondenten", { name: "Vodafone", abgleich: "exakt", abgleichText: "Vodafone GmbH" });
    const typ = await anlegen("/api/dokumenttypen", {
      name: "Rechnung",
      abgleich: "regex",
      abgleichText: "rechnung\\s+nr\\.?\\s*\\d+",
    });
    const handy = await anlegen("/api/tags", {
      name: "Handy",
      abgleich: "unscharf",
      abgleichText: "Mobilfunk Vertrag",
    });
    await anlegen("/api/tags", { name: "Strom", abgleich: "alle_woerter", abgleichText: "strom zählerstand" });
    // Ein Ausdruck mit katastrophalem Backtracking trifft nicht und hält die anderen nicht auf
    await anlegen("/api/tags", { name: "Langsam", abgleich: "regex", abgleichText: "(a+)+$" });

    const d = await hoch(`${"a".repeat(40)}!\nIhre MAGENTA Rechnung Nr. 4711 für den Mobilfunk-Vertrag`, "brief.txt");
    // Vor dem Lesen des Texts gibt es nichts auszuwerten
    expect(await zuordnungVorschlaegeErzeugen(t.db, { ocr: false })).toEqual({ ausgewertet: 0, treffer: 0 });
    expect(await worker()).toEqual({ ausgewertet: 1, treffer: 1 });
    const v = await vorschlag(d.id);
    expect(v.zuordnung).toEqual({
      korrespondent: { id: tel.id, name: "Telekom" },
      dokumenttyp: { id: typ.id, name: "Rechnung" },
      tags: [{ id: handy.id, name: "Handy", farbe: "grau" }],
      felder: [],
      uebersprungen: expect.any(Array),
    });
    // Ausgewertet wird einmal; gesetzt ist nichts
    expect(await worker()).toEqual({ ausgewertet: 0, treffer: 0 });
    const dok = await (await als(inhaber)(`/api/dokumente/${d.id}`)).json();
    expect(dok.korrespondent).toBeNull();
    expect(dok.tags).toEqual([]);

    // Übernehmen setzt die Ordnung über die gewohnte Änderung
    const ok = await als(inhaber)(
      `/api/dokumente/${d.id}/ordnung`,
      json({ korrespondent: tel.id, dokumenttyp: typ.id, tagsHinzu: [handy.id] }),
    );
    expect((await ok.json()).korrespondent).toEqual({ id: tel.id, name: "Telekom" });
  });

  it("meldet einen Ausdruck über dem Zeitlimit und wertet nach einer geänderten Regel den Eingang neu aus", async () => {
    const d = await hoch(`${"a".repeat(40)}!`, "langsam.txt");
    await worker();
    expect((await vorschlag(d.id)).zuordnung).toBeNull();
    const [z] = await t.sql`select vorschlag from zuordnung_vorschlaege where dokument_id = ${d.id}`;
    expect(z!.vorschlag.uebersprungen).toContain("Langsam");

    const [langsam] = await t.sql`select id from tags where name = 'Langsam'`;
    await als(inhaber)(`/api/tags/${langsam!.id}`, json({ abgleich: "regex", abgleichText: "a{10}!" }, "PATCH"));
    expect(await t.sql`select 1 from zuordnung_vorschlaege where dokument_id = ${d.id}`).toHaveLength(0);
    await worker();
    expect((await vorschlag(d.id)).zuordnung?.tags.map((x) => x.name)).toEqual(["Langsam"]);
    expect((await als(inhaber)(`/api/tags/${langsam!.id}`, json({ abgleichText: "x" }, "PATCH"))).status).toBe(200);
    expect(
      (await als(inhaber)(`/api/tags/${langsam!.id}`, json({ abgleich: "regex", abgleichText: "(" }, "PATCH"))).status,
    ).toBe(400);
  });

  it("der Vorschlag der Regeln geht mit der Löschung", async () => {
    const d = await hoch("Ihre MAGENTA Rechnung", "weg.txt");
    await worker();
    expect(await t.sql`select 1 from zuordnung_vorschlaege where dokument_id = ${d.id}`).toHaveLength(1);
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-01" }));
    expect((await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect(await t.sql`select 1 from zuordnung_vorschlaege where dokument_id = ${d.id}`).toHaveLength(0);
    const doku = JSON.stringify(await (await als(inhaber)("/api/verfahrensdoku")).json());
    expect(doku).toContain("Zuordnungsregel Korrespondent „Telekom“: irgendein Wort aus „telekom magenta“");
  });
});
