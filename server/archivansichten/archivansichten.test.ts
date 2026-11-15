import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";

describe.skipIf(!testDatenbankUrl)("Gespeicherte Ansichten gegen Postgres", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let steuer: string;
  let pruefer: string;
  const senden = (cookie: string, methode: string, pfad: string, body?: unknown) =>
    t.anfrage(
      pfad,
      body === undefined
        ? { method: methode }
        : { method: methode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );
  const liste = async (cookie: string) =>
    (await (await senden(cookie, "GET", "/api/ansichten")).json()) as {
      id: string;
      name: string;
      parameter: Record<string, string>;
      fuerAlle: boolean;
      eigene: boolean;
    }[];

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    steuer = await zugangAnlegen(t, inhaber, "stb@example.org", { rolle: "steuerberatung" });
    pruefer = await zugangAnlegen(t, inhaber, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
  });
  afterAll(() => t?.aufraeumen());

  it("speichert Parameter in fester Form, je Zugang; „für alle“ sieht die Steuerberatung, der Prüfer nicht", async () => {
    const eigene = await senden(inhaber, "POST", "/api/ansichten", {
      name: "Strom",
      parameter: { suche: " Strom ", gruppe: "pflicht", seite: "3", unbekannt: "x" },
    });
    expect(eigene.status).toBe(201);
    expect(await eigene.json()).toMatchObject({
      name: "Strom",
      parameter: { suche: "Strom", gruppe: "pflicht" },
      fuerAlle: false,
      eigene: true,
    });
    const geteilt = await senden(inhaber, "POST", "/api/ansichten", {
      name: "Offene Belege",
      parameter: { gruppe: "offen" },
      fuerAlle: true,
    });
    expect(geteilt.status).toBe(201);
    expect((await senden(steuer, "POST", "/api/ansichten", { name: "Meine", parameter: {} })).status).toBe(201);
    expect((await senden(pruefer, "POST", "/api/ansichten", { name: "Prüfung", parameter: {} })).status).toBe(201);

    expect((await liste(inhaber)).map((a) => a.name)).toEqual(["Strom", "Offene Belege"]);
    expect((await liste(steuer)).map((a) => [a.name, a.eigene])).toEqual([
      ["Offene Belege", false],
      ["Meine", true],
    ]);
    expect((await liste(pruefer)).map((a) => a.name)).toEqual(["Prüfung"]);
  });

  it("nur der Inhaber gibt für alle frei; fremde Ansichten ändert und löscht niemand", async () => {
    expect((await senden(steuer, "POST", "/api/ansichten", { name: "X", parameter: {}, fuerAlle: true })).status).toBe(
      403,
    );
    const geteilt = (await liste(steuer)).find((a) => a.name === "Offene Belege")!;
    expect((await senden(steuer, "PATCH", `/api/ansichten/${geteilt.id}`, { name: "Meins" })).status).toBe(404);
    expect((await senden(steuer, "DELETE", `/api/ansichten/${geteilt.id}`)).status).toBe(404);
    expect((await senden(pruefer, "DELETE", `/api/ansichten/${geteilt.id}`)).status).toBe(404);
    const meine = (await liste(steuer)).find((a) => a.name === "Meine")!;
    expect((await senden(steuer, "PATCH", `/api/ansichten/${meine.id}`, { fuerAlle: true })).status).toBe(403);
    expect((await senden(inhaber, "PATCH", `/api/ansichten/${meine.id}`, { name: "Gestohlen" })).status).toBe(404);
  });

  it("Name je Zugang eindeutig ohne Groß- und Kleinschreibung, bei anderen Zugängen frei", async () => {
    expect((await senden(inhaber, "POST", "/api/ansichten", { name: "STROM", parameter: {} })).status).toBe(409);
    expect((await senden(steuer, "POST", "/api/ansichten", { name: "Strom", parameter: {} })).status).toBe(201);
    expect((await senden(inhaber, "POST", "/api/ansichten", { name: "  ", parameter: {} })).status).toBe(400);
  });

  it("umbenennen, Reihenfolge und löschen, alles im Audit-Log", async () => {
    const vorher = await liste(inhaber);
    const strom = vorher.find((a) => a.name === "Strom")!;
    const offen = vorher.find((a) => a.name === "Offene Belege")!;
    const umbenannt = await senden(inhaber, "PATCH", `/api/ansichten/${strom.id}`, {
      name: "Strom und Gas",
      parameter: { suche: "Gas", sortierung: "alt" },
    });
    expect(await umbenannt.json()).toMatchObject({
      name: "Strom und Gas",
      parameter: { suche: "Gas", sortierung: "alt" },
    });
    expect((await senden(inhaber, "POST", "/api/ansichten/reihenfolge", { ids: [offen.id, strom.id] })).status).toBe(
      200,
    );
    expect((await liste(inhaber)).map((a) => a.name)).toEqual(["Offene Belege", "Strom und Gas"]);
    // Eine fremde ID in der Reihenfolge ändert nichts
    const fremd = (await liste(steuer)).find((a) => a.eigene)!;
    expect((await senden(inhaber, "POST", "/api/ansichten/reihenfolge", { ids: [strom.id, fremd.id] })).status).toBe(
      404,
    );
    expect((await liste(inhaber)).map((a) => a.name)).toEqual(["Offene Belege", "Strom und Gas"]);

    expect((await senden(inhaber, "DELETE", `/api/ansichten/${strom.id}`)).status).toBe(200);
    expect((await liste(inhaber)).map((a) => a.name)).toEqual(["Offene Belege"]);
    const log = await t.sql<{ action: string; actor: string; old_value: { name: string } | null }[]>`
      select action, actor, old_value from audit_log
       where table_name = 'gespeicherte_ansichten' and row_id = ${strom.id} order by seq`;
    expect(log.map((e) => e.action)).toEqual(["INSERT", "UPDATE", "UPDATE", "DELETE"]);
    expect(log.every((e) => e.actor === "nutzer:anna@example.org")).toBe(true);
    expect(log.at(-1)!.old_value!.name).toBe("Strom und Gas");
    const [kette] = await t.sql<{ n: number }[]>`select count(*)::int as n from belegt_integrity_problems(10)`;
    expect(kette!.n).toBe(0);
  });

  it("Programme mit Token haben keine Ansichten", async () => {
    const token = await tokenAnlegen(t, inhaber, "schreiben");
    const res = await t.app.request("http://localhost:3000/api/ansichten", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("die Liste sortiert nach Wunsch", async () => {
    for (const name of ["b.txt", "a.txt", "c.txt"]) {
      const f = new FormData();
      f.append("datei", new File([new TextEncoder().encode(name)], name));
      await t.anfrage("/api/dokumente", { method: "POST", body: f }, inhaber);
    }
    const namen = async (sortierung: string) =>
      (
        (await (await senden(inhaber, "GET", `/api/dokumente?sortierung=${sortierung}`)).json()) as {
          dateiname: string;
        }[]
      ).map((d) => d.dateiname);
    expect(await namen("neu")).toEqual(["c.txt", "a.txt", "b.txt"]);
    expect(await namen("alt")).toEqual(["b.txt", "a.txt", "c.txt"]);
    expect(await namen("titel")).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect((await senden(inhaber, "GET", "/api/dokumente?sortierung=zufall")).status).toBe(400);
  });
});
