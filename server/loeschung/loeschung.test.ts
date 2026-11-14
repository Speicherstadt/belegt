import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Löschlauf gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function dokument(
    inhalt: string,
    art: string,
    entstanden: string,
    freiwilligBis?: string,
  ): Promise<{ id: string; sha256: string }> {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], `${inhalt}.pdf`));
    const d = await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json();
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art, entstanden, freiwilligBis }));
    return d;
  }

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

  it("löscht nach Fristende erst mit der Bestätigung einer zweiten Person; die Zeile bleibt als Nachweis", async () => {
    const d = await dokument("beleg-2017", "beleg", "2017-05-10");
    const antrag = await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" });
    expect(antrag.status).toBe(201);
    const { id } = await antrag.json();
    expect(existsSync(t.speicher.pfad(d.sha256))).toBe(true);

    const selbst = await als(inhaber)(`/api/loeschungen/${id}/bestaetigen`, { method: "POST" });
    expect(selbst.status).toBe(409);
    expect((await selbst.json()).fehler).toMatch(/zweite Person/);

    const zweite = await als(kanzlei)(`/api/loeschungen/${id}/bestaetigen`, { method: "POST" });
    expect(zweite.status).toBe(200);
    expect(existsSync(t.speicher.pfad(d.sha256))).toBe(false);
    expect((await als(inhaber)(`/api/dokumente/${d.id}/datei`)).status).toBe(410);
    const nachweis = await (await als(inhaber)(`/api/dokumente/${d.id}`)).json();
    expect(nachweis).toMatchObject({ sha256: d.sha256, loeschung: { bestaetigtVon: "nutzer:kanzlei@example.org" } });

    const ids = async (gruppe: string) =>
      (await (await als(inhaber)(`/api/dokumente?gruppe=${gruppe}`)).json()).map((x: { id: string }) => x.id);
    expect(await ids("alle")).not.toContain(d.id);
    expect(await ids("geloescht")).toContain(d.id);
    await expect(t.sql`update loeschungen set bestaetigt_von = 'x' where id = ${id}`).rejects.toThrow(
      /festgeschrieben/,
    );
    const spaeter = await als(inhaber)(
      `/api/dokumente/${d.id}/einordnung`,
      json({ art: "buecher", entstanden: "2017-05-10" }),
    );
    expect(spaeter.status).toBe(409);
    expect(await spaeter.json()).toEqual({ fehler: "Das Dokument ist gelöscht" });
  });

  it("lehnt die Löschung vor Fristende, unter einer Sperre und ohne Einordnung ab, auch direkt in der Datenbank", async () => {
    const laufend = await dokument("beleg-2026", "beleg", "2026-03-01");
    const res = await als(inhaber)(`/api/dokumente/${laufend.id}/loeschung`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).fehler).toMatch(/Frist läuft noch bis 2034-12-31/);
    await expect(
      t.sql`insert into loeschungen (dokument_id, beantragt_von) values (${laufend.id}, 'x')`,
    ).rejects.toThrow(/Frist läuft noch/);

    const gesperrt = await dokument("beleg-2016", "beleg", "2016-02-02");
    const sperre = await (
      await als(inhaber)("/api/sperren", json({ grund: "Prüfung", von: "2016-01-01", bis: "2016-12-31" }))
    ).json();
    expect((await als(inhaber)(`/api/dokumente/${gesperrt.id}/loeschung`, { method: "POST" })).status).toBe(409);
    await als(inhaber)(`/api/sperren/${sperre.id}/aufheben`, { method: "POST" });
    expect((await als(inhaber)(`/api/dokumente/${gesperrt.id}/loeschung`, { method: "POST" })).status).toBe(201);

    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode("ohne")], "ohne.pdf"));
    const ohne = await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json();
    expect((await als(inhaber)(`/api/dokumente/${ohne.id}/loeschung`, { method: "POST" })).status).toBe(409);
  });

  it("löscht frei Abgelegtes sofort, behält aber eine Datei, die ein anderes Dokument noch braucht", async () => {
    const erst = await dokument("gleicher-inhalt", "frei", "2026-01-01");
    const zweit = await dokument("gleicher-inhalt", "beleg", "2026-01-01");
    expect(zweit.sha256).toBe(erst.sha256);
    const res = await als(inhaber)(`/api/dokumente/${erst.id}/loeschung`, { method: "POST" });
    expect(res.status).toBe(201);
    expect((await res.json()).bestaetigtVon).toBe("nutzer:anna@example.org");
    expect(existsSync(t.speicher.pfad(erst.sha256))).toBe(true);
    expect((await als(inhaber)(`/api/dokumente/${zweit.id}/datei`)).status).toBe(200);
  });

  it("lässt einen offenen Antrag zurückziehen, Prüfer dürfen nicht bestätigen", async () => {
    const d = await dokument("beleg-2015", "beleg", "2015-03-03");
    const { id } = await (await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).json();
    expect((await als(kanzlei)(`/api/loeschungen/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await als(inhaber)(`/api/loeschungen/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await als(inhaber)(`/api/loeschungen/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("hat nach allem eine intakte Kette", async () => {
    expect(await (await als(inhaber)("/api/pruefung")).json()).toEqual({ ok: true, befunde: [] });
  });
});
