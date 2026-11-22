import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe.skipIf(!testDatenbankUrl)("Eigene Fristvorlagen gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("legt Vorlagen an, listet sie nach Name und lehnt doppelte Namen und Unsinn ab", async () => {
    const garantie = await als(inhaber)("/api/fristvorlagen", json({ name: "Garantie", monate: 24 }));
    expect(garantie.status).toBe(201);
    expect(await garantie.json()).toMatchObject({ name: "Garantie", monate: 24 });
    expect((await als(inhaber)("/api/fristvorlagen", json({ name: "Arbeitsvertrag", monate: 120 }))).status).toBe(201);
    expect((await als(inhaber)("/api/fristvorlagen", json({ name: "garantie", monate: 12 }))).status).toBe(409);
    expect((await als(inhaber)("/api/fristvorlagen", json({ name: "Null", monate: 0 }))).status).toBe(400);
    expect((await als(inhaber)("/api/fristvorlagen", json({ name: "", monate: 6 }))).status).toBe(400);

    const liste = (await (await als(inhaber)("/api/fristvorlagen")).json()) as { name: string }[];
    expect(liste.map((v) => v.name)).toEqual(["Arbeitsvertrag", "Garantie"]);
  });

  it("die Steuerberatung liest, ändert aber nichts; der Inhaber löscht", async () => {
    expect((await als(kanzlei)("/api/fristvorlagen")).status).toBe(200);
    expect((await als(kanzlei)("/api/fristvorlagen", json({ name: "Kanzlei", monate: 6 }))).status).toBe(403);
    const [v] = (await (await als(inhaber)("/api/fristvorlagen")).json()) as { id: string }[];
    expect((await als(inhaber)(`/api/fristvorlagen/${v!.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await als(inhaber)(`/api/fristvorlagen/${v!.id}`, { method: "DELETE" })).status).toBe(404);
  });
});
