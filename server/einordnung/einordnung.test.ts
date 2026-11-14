import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Einordnung, Sperren und Übersicht gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function hochladen(inhalt: string, name: string): Promise<string> {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], name));
    return (await (await anfrage("/api/dokumente", { method: "POST", body: form })).json()).id;
  }

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("ordnet ein, rechnet die Frist nach § 147 AO und versiegelt die Einordnung", async () => {
    const id = await hochladen("Beleg 1", "beleg-1.pdf");
    const res = await anfrage(
      `/api/dokumente/${id}/einordnung`,
      json({ art: "beleg", entstanden: "2026-03-15", titel: "Telefon März" }),
    );
    expect(res.status).toBe(201);
    const e = await res.json();
    expect(e).toMatchObject({ art: "beleg", entstanden: "2026-03-15", fristBis: "2034-12-31", titel: "Telefon März" });
    expect(await t.sql`select 1 from seals where table_name = 'einordnungen' and row_id = ${e.id}`).toHaveLength(1);
    await expect(t.sql`update einordnungen set frist_bis = '2027-12-31' where id = ${e.id}`).rejects.toThrow(
      /darf nur ergänzt werden/,
    );

    const dok = await (await anfrage(`/api/dokumente/${id}`)).json();
    expect(dok.einordnung).toMatchObject({ id: e.id, art: "beleg" });
  });

  it("nimmt bei einer neuen Einordnung die neueste, die alte bleibt im Verlauf", async () => {
    const id = await hochladen("Vertrag", "vertrag.pdf");
    await anfrage(`/api/dokumente/${id}/einordnung`, json({ art: "geschaeftsbrief", entstanden: "2026-01-10" }));
    await anfrage(
      `/api/dokumente/${id}/einordnung`,
      json({ art: "freiwillig", entstanden: "2026-01-10", freiwilligBis: "2031-12-31" }),
    );
    const dok = await (await anfrage(`/api/dokumente/${id}`)).json();
    expect(dok.einordnung).toMatchObject({ art: "freiwillig", fristBis: "2031-12-31" });
    const { ereignisse } = await (await anfrage(`/api/dokumente/${id}/verlauf`)).json();
    expect(ereignisse.filter((e: { tabelle: string }) => e.tabelle === "einordnungen")).toHaveLength(2);
  });

  it("lehnt ungültige Einordnungen mit 400 ab", async () => {
    const id = await hochladen("x", "x.pdf");
    const fall = async (body: unknown) => (await anfrage(`/api/dokumente/${id}/einordnung`, json(body))).status;
    expect(await fall({ art: "geheim", entstanden: "2026-01-01" })).toBe(400);
    expect(await fall({ art: "beleg", entstanden: "01.01.2026" })).toBe(400);
    expect(await fall({ art: "beleg", entstanden: "2026-02-30" })).toBe(400);
    expect(await fall({ art: "freiwillig", entstanden: "2026-01-01" })).toBe(400);
    expect(
      (
        await anfrage(
          "/api/dokumente/00000000-0000-4000-8000-000000000000/einordnung",
          json({ art: "frei", entstanden: "2026-01-01" }),
        )
      ).status,
    ).toBe(404);
  });

  it("filtert die Liste nach Eingang (offen) und Aufbewahrung", async () => {
    const offen = await hochladen("offen", "offen.pdf");
    const frei = await hochladen("frei", "handbuch.pdf");
    await anfrage(`/api/dokumente/${frei}/einordnung`, json({ art: "frei", entstanden: "2026-05-01" }));
    const ids = async (gruppe: string) =>
      (await (await anfrage(`/api/dokumente?gruppe=${gruppe}`)).json()).map((d: { id: string }) => d.id);
    expect(await ids("offen")).toContain(offen);
    expect(await ids("offen")).not.toContain(frei);
    expect(await ids("frei")).toEqual([frei]);
    expect(await ids("pflicht")).not.toContain(frei);
  });

  it("legt Sperren an, hebt sie einmal auf und zählt gesperrte und löschbare Dokumente", async () => {
    const alt = await hochladen("alter Beleg", "beleg-2017.pdf");
    await anfrage(`/api/dokumente/${alt}/einordnung`, json({ art: "beleg", entstanden: "2017-05-10" }));
    let u = await (await anfrage("/api/fristen/uebersicht")).json();
    expect(u.loeschbar).toBeGreaterThanOrEqual(1);
    const vorher = u.loeschbar;

    const sperre = await (
      await anfrage("/api/sperren", json({ grund: "Betriebsprüfung 2017", von: "2017-01-01", bis: "2017-12-31" }))
    ).json();
    u = await (await anfrage("/api/fristen/uebersicht")).json();
    expect(u.gesperrt).toBe(1);
    expect(u.loeschbar).toBe(vorher - 1);

    expect((await anfrage(`/api/sperren/${sperre.id}/aufheben`, { method: "POST" })).status).toBe(200);
    expect((await anfrage(`/api/sperren/${sperre.id}/aufheben`, { method: "POST" })).status).toBe(404);
    await expect(t.sql`update sperren set grund = 'anders' where id = ${sperre.id}`).rejects.toThrow(
      /nur einmal aufheben/,
    );
    await expect(t.sql`delete from sperren where id = ${sperre.id}`).rejects.toThrow(/nicht gelöscht/);
    expect((await anfrage("/api/sperren", json({ grund: "x", von: "2020-02-01", bis: "2020-01-01" }))).status).toBe(
      400,
    );
  });

  it("hat nach allem eine intakte Kette", async () => {
    expect(await (await anfrage("/api/pruefung")).json()).toEqual({ ok: true, befunde: [] });
  });
});
