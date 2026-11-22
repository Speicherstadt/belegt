import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Archiv nach Tags: ohne Tags und ausgeschlossene Tags gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  let rot: string;
  let blau: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const hoch = async (name: string, tags: string[]) => {
    const f = new FormData();
    f.append("datei", new File([name], name));
    const { id } = (await (await anfrage("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
    if (tags.length)
      expect((await anfrage(`/api/dokumente/${id}/ordnung`, json({ tagsHinzu: tags }))).status).toBe(200);
  };
  const liste = async (abfrage: string) =>
    ((await (await anfrage(`/api/dokumente?${abfrage}`)).json()) as { dateiname: string }[])
      .map((d) => d.dateiname)
      .sort();

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    rot = ((await (await anfrage("/api/tags", json({ name: "Rot" }))).json()) as { id: string }).id;
    blau = ((await (await anfrage("/api/tags", json({ name: "Blau" }))).json()) as { id: string }).id;
    await hoch("rot.txt", [rot]);
    await hoch("beide.txt", [rot, blau]);
    await hoch("ohne.txt", []);
  });
  afterAll(() => t?.aufraeumen());

  it("ohneTags zeigt nur Dokumente ohne jeden Tag", async () => {
    expect(await liste("ohneTags=1")).toEqual(["ohne.txt"]);
  });

  it("tagNicht schließt Dokumente mit diesem Tag aus, auch zusammen mit einem gewählten Tag", async () => {
    expect(await liste(`tagNicht=${blau}`)).toEqual(["ohne.txt", "rot.txt"]);
    expect(await liste(`tag=${rot}&tagNicht=${blau}`)).toEqual(["rot.txt"]);
  });

  it("lehnt Unsinn ab", async () => {
    expect((await anfrage("/api/dokumente?tagNicht=kaputt")).status).toBe(400);
    expect((await anfrage("/api/dokumente?ohneTags=vielleicht")).status).toBe(400);
  });
});
