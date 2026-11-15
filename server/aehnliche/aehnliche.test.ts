import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";

describe.skipIf(!testDatenbankUrl)("Ähnliche Dokumente gegen Postgres", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const als = (pfad: string, init: RequestInit = {}, c = cookie) => t.anfrage(pfad, init, c);
  const post = (pfad: string, body?: unknown) =>
    als(
      pfad,
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
  const hoch = async (name: string, text: string, entstanden: string, art = "frei") => {
    const f = new FormData();
    f.append("datei", new File([new TextEncoder().encode(text)], name));
    const d = (await (await als("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
    await post(`/api/dokumente/${d.id}/einordnung`, { art, entstanden });
    return d.id;
  };
  const aehnliche = async (id: string, c = cookie) =>
    ((await (await als(`/api/dokumente/${id}/aehnliche`, {}, c)).json()) as { id: string }[]).map((d) => d.id);

  let januar: string;
  let februar: string;
  let wasser: string;
  let miete: string;
  let kfz: string;

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    januar = await hoch(
      "strom-januar.txt",
      "Stromrechnung Stadtwerke Musterstadt Abschlag Januar Zählerstand Kilowattstunden Arbeitspreis",
      "2024-01-15",
    );
    februar = await hoch(
      "strom-februar.txt",
      "Stromrechnung Stadtwerke Musterstadt Abschlag Februar Zählerstand Kilowattstunden Arbeitspreis",
      "2024-02-15",
    );
    wasser = await hoch("wasser.txt", "Wasserrechnung Stadtwerke Musterstadt Abwasser Gebühren", "2022-03-01");
    miete = await hoch("miete.txt", "Mietvertrag Wohnung Gartenstraße Kaution Nebenkosten", "2024-04-01");
    kfz = await hoch("kfz.txt", "Kfz Versicherung Beitrag Haftpflicht Vollkasko", "2024-05-01");
    while ((await inhalteErzeugen(t)).gelesen > 0);
  });
  afterAll(() => t?.aufraeumen());

  it("ordnet nach Ähnlichkeit, ohne das Dokument selbst und ohne Unverwandtes", async () => {
    const treffer = await aehnliche(januar);
    expect(treffer.slice(0, 2)).toEqual([februar, wasser]);
    expect(treffer).not.toContain(januar);
    expect(treffer).not.toContain(miete);
    expect(treffer).not.toContain(kfz);
    // Nichts Gemeinsames: keine Treffer
    expect(await aehnliche(kfz)).toEqual([]);
    expect((await als("/api/dokumente/00000000-0000-4000-8000-000000000000/aehnliche")).status).toBe(404);
  });

  it("nennt höchstens fünf", async () => {
    for (let i = 0; i < 6; i++)
      await hoch(`strom-${i}.txt`, `Stromrechnung Stadtwerke Musterstadt Abschlag Monat${i}`, "2024-06-01");
    while ((await inhalteErzeugen(t)).gelesen > 0);
    expect(await aehnliche(januar)).toHaveLength(5);
  });

  it("zeigt Prüfern nur Dokumente ihres Zeitraums, Tokens mit dem Recht lesen alle", async () => {
    const pruefer = await zugangAnlegen(t, cookie, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-03-31" },
    });
    expect(await aehnliche(januar, pruefer)).toEqual([februar]);
    const token = await tokenAnlegen(t, cookie, "lesen");
    const res = await t.anfrage(`/api/dokumente/${januar}/aehnliche`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(((await res.json()) as { id: string }[]).map((d) => d.id)).toContain(februar);
  });

  it("lässt gelöschte Dokumente weg", async () => {
    expect((await post(`/api/dokumente/${februar}/loeschung`)).status).toBe(201);
    expect(await aehnliche(januar)).not.toContain(februar);
  });
});
