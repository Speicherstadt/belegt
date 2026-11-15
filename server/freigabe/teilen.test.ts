import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { geteiltZahlen } from "./teilen.ts";

describe.skipIf(!testDatenbankUrl)("Teilen per Link gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  let pruefer: string;
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const hoch = async (inhalt: string, name: string) => {
    const f = new FormData();
    f.append("datei", new File([inhalt], name));
    return (await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
  };
  const einladen = async (body: object, email: string) => {
    const { pfad } = await (await als(inhaber)("/api/einladungen", json(body))).json();
    return (await t.registrieren(email, "ein-langes-passwort", { "x-belegt-einladung": pfad.split("/").pop() })).cookie;
  };
  const teilen = async (id: string, tage: number) =>
    (await (await als(inhaber)(`/api/dokumente/${id}/links`, json({ tage }))).json()) as {
      id: string;
      url: string;
      gueltigBis: string;
    };
  /** Ohne Cookie und ohne Origin, wie ein Browser, der den Link öffnet */
  const abrufen = (url: string, init: RequestInit = {}) => t.app.request(url, init);
  const links = async (id: string) =>
    (await (await als(inhaber)(`/api/dokumente/${id}/links`)).json()) as {
      id: string;
      abrufe: number;
      letzterAbruf: string | null;
    }[];

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    kanzlei = await einladen({ rolle: "steuerberatung" }, "kanzlei@example.org");
    pruefer = await einladen({ rolle: "pruefer", zeitraum: { von: "2000-01-01", bis: "2100-12-31" } }, "p@example.org");
  });
  afterAll(() => t?.aufraeumen());

  it("gibt das Original ohne Anmeldung als Download heraus und hält jeden Abruf fest", async () => {
    const d = await hoch("Mietvertrag", "Mietvertrag (2026).pdf");
    const res = await als(inhaber)(`/api/dokumente/${d.id}/links`, json({ tage: 7 }));
    expect(res.status).toBe(201);
    const link = await res.json();
    expect(link.url).toMatch(/^http:\/\/localhost:3000\/api\/geteilt\/[A-Za-z0-9_-]{43}$/);
    const tage = (new Date(link.gueltigBis).getTime() - Date.now()) / 86_400_000;
    expect(tage).toBeGreaterThan(6.99);
    expect(tage).toBeLessThanOrEqual(7);
    expect(await links(d.id)).toMatchObject([{ id: link.id, abrufe: 0, letzterAbruf: null }]);

    const datei = await abrufen(link.url);
    expect(datei.status).toBe(200);
    expect(await datei.text()).toBe("Mietvertrag");
    expect(datei.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''Mietvertrag%20%282026%29.pdf");
    expect(datei.headers.get("cache-control")).toBe("no-store");
    expect(datei.headers.get("referrer-policy")).toBe("no-referrer");
    expect(datei.headers.get("x-content-type-options")).toBe("nosniff");
    // Nur der Kopf (Vorschau im Messenger): kein Abruf
    expect((await abrufen(link.url, { method: "HEAD" })).status).toBe(200);
    expect((await abrufen(link.url)).status).toBe(200);

    const [eintrag] = await links(d.id);
    expect(eintrag?.abrufe).toBe(2);
    expect(eintrag?.letzterAbruf).not.toBeNull();
    // Abrufe nur mit Zeitpunkt, ohne Angaben zur Person; im Protokoll steht der Link als Akteur
    expect(Object.keys((await t.sql`select * from freigabe_abrufe limit 1`)[0]!).sort()).toEqual([
      "abgerufen_am",
      "freigabe_id",
      "id",
    ]);
    const log = await t.sql`select actor from audit_log where table_name = 'freigabe_abrufe'`;
    expect(log.map((z) => z.actor)).toEqual([`link:${link.id}`, `link:${link.id}`]);
  });

  it("speichert den Link nirgends im Klartext und lässt Freigabe, Abrufe und Widerruf nicht ändern", async () => {
    const d = await hoch("geheim", "a.pdf");
    const link = await teilen(d.id, 1);
    const token = link.url.split("/").pop()!;
    await abrufen(link.url);
    const [f] = await t.sql`select * from freigaben where id = ${link.id}`;
    expect(f!.zweck).toBe("teilen");
    expect(JSON.stringify(f)).not.toContain(token);
    const log =
      await t.sql`select coalesce(new_value::text, '') || coalesce(old_value::text, '') as daten from audit_log`;
    expect(log.some((z) => String(z.daten).includes(token))).toBe(false);
    expect(log.length).toBeGreaterThan(0);

    await expect(
      t.sql`update freigaben set gueltig_bis = now() + interval '1 year' where id = ${link.id}`,
    ).rejects.toThrow();
    await expect(t.sql`delete from freigabe_abrufe`).rejects.toThrow();
    await expect(t.sql`update freigabe_abrufe set abgerufen_am = now()`).rejects.toThrow();
    // Länger als 30 Tage lässt Postgres nicht zu, auch nicht an der App vorbei
    await expect(
      t.sql`insert into freigaben (dokument_id, token_hash, erstellt_von, gueltig_bis, zweck)
            values (${d.id}, 'x', 'test', now() + interval '60 days', 'teilen')`,
    ).rejects.toThrow(/freigaben_teilen_dauer/);
  });

  it("nimmt nur 1, 7 oder 30 Tage an", async () => {
    const d = await hoch("x", "b.pdf");
    for (const tage of [1, 30])
      expect((await als(inhaber)(`/api/dokumente/${d.id}/links`, json({ tage }))).status).toBe(201);
    for (const body of [{ tage: 2 }, { tage: 31 }, { tage: "7" }, {}])
      expect((await als(inhaber)(`/api/dokumente/${d.id}/links`, json(body))).status).toBe(400);
  });

  it("antwortet nach Ablauf mit 404 und zeigt den Link nicht mehr", async () => {
    const d = await hoch("alt", "c.pdf");
    const vorher = Date.now;
    Date.now = () => vorher() - 2 * 86_400_000;
    const alt = await teilen(d.id, 1);
    Date.now = vorher;
    const neu = await teilen(d.id, 1);
    expect((await abrufen(alt.url)).status).toBe(404);
    expect((await links(d.id)).map((l) => l.id)).toEqual([neu.id]);
    // Auch an der App vorbei nimmt Postgres keinen Abruf eines abgelaufenen Links an
    await expect(t.sql`insert into freigabe_abrufe (freigabe_id) values (${alt.id})`).rejects.toThrow(/abgelaufen/);
  });

  it("widerruft einen Link: danach 404, ein zweites Mal nicht, und der Widerruf steht im Protokoll", async () => {
    const d = await hoch("w", "d.pdf");
    const andere = await hoch("v", "e.pdf");
    const link = await teilen(d.id, 30);
    // Nur über sein eigenes Dokument
    expect(
      (await als(inhaber)(`/api/dokumente/${andere.id}/links/${link.id}/widerrufen`, { method: "POST" })).status,
    ).toBe(404);
    expect((await als(inhaber)(`/api/dokumente/${d.id}/links/${link.id}/widerrufen`, { method: "POST" })).status).toBe(
      200,
    );
    expect((await abrufen(link.url)).status).toBe(404);
    expect(await links(d.id)).toEqual([]);
    expect((await als(inhaber)(`/api/dokumente/${d.id}/links/${link.id}/widerrufen`, { method: "POST" })).status).toBe(
      404,
    );
    const log = await t.sql`select actor from audit_log where table_name = 'freigabe_widerrufe'`;
    expect(log.map((z) => z.actor)).toEqual(["nutzer:anna@example.org"]);
    await expect(t.sql`delete from freigabe_widerrufe`).rejects.toThrow();
    await expect(t.sql`insert into freigabe_abrufe (freigabe_id) values (${link.id})`).rejects.toThrow(/widerrufen/);
  });

  it("antwortet nach der Löschung des Dokuments mit 410", async () => {
    const d = await hoch("weg", "f.pdf");
    const link = await teilen(d.id, 7);
    const vorher = await geteiltZahlen(t.db);
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-02" }));
    expect((await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect((await abrufen(link.url)).status).toBe(410);
    // Die Verfahrensdokumentation zählt den Link nicht mehr als gültig, und die Liste zeigt ihn nicht mehr
    expect(await geteiltZahlen(t.db)).toEqual({ jemals: vorher.jemals, aktiv: vorher.aktiv - 1 });
    expect(await links(d.id)).toEqual([]);
    expect((await als(inhaber)(`/api/dokumente/${d.id}/links`, json({ tage: 1 }))).status).toBe(410);
  });

  it("lässt nur den Inhaber teilen, nicht Steuerberatung, Prüfer oder ein API-Token", async () => {
    const d = await hoch("rolle", "g.pdf");
    for (const cookie of [kanzlei, pruefer]) {
      expect((await als(cookie)(`/api/dokumente/${d.id}/links`, json({ tage: 1 }))).status).toBe(403);
      expect((await als(cookie)(`/api/dokumente/${d.id}/links`)).status).toBe(403);
    }
    const link = await teilen(d.id, 1);
    expect((await als(kanzlei)(`/api/dokumente/${d.id}/links/${link.id}/widerrufen`, { method: "POST" })).status).toBe(
      403,
    );
    const { klartext } = await (await als(inhaber)("/api/tokens", json({ name: "Skript", recht: "schreiben" }))).json();
    const mitToken = { authorization: `Bearer ${klartext}`, "content-type": "application/json" };
    expect(
      (
        await t.app.request(`http://localhost:3000/api/dokumente/${d.id}/links`, {
          method: "POST",
          headers: mitToken,
          body: JSON.stringify({ tage: 1 }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await t.app.request(`http://localhost:3000/api/dokumente/${d.id}/links`, { headers: mitToken })).status,
    ).toBe(403);
  });

  it("trennt geteilte Links von „Öffnen mit …“", async () => {
    const mitApp = await testApp({ oeffnenMit: { name: "Office", url: "https://office.example/?datei={url}" } });
    try {
      const cookie = (await mitApp.registrieren("b@example.org")).cookie;
      const f = new FormData();
      f.append("datei", new File(["x"], "x.docx"));
      const d = await (await mitApp.anfrage("/api/dokumente", { method: "POST", body: f }, cookie)).json();
      const oeffnen = await (
        await mitApp.anfrage(`/api/dokumente/${d.id}/freigabe`, { method: "POST" }, cookie)
      ).json();
      const oeffnenToken = new URL(new URL(oeffnen.url).searchParams.get("datei")!).pathname.split("/").pop();
      const geteilt = await (await mitApp.anfrage(`/api/dokumente/${d.id}/links`, json({ tage: 1 }), cookie)).json();
      const geteiltToken = geteilt.url.split("/").pop();
      expect((await mitApp.app.request(`http://localhost:3000/api/geteilt/${oeffnenToken}`)).status).toBe(404);
      expect((await mitApp.app.request(`http://localhost:3000/api/freigabe/${geteiltToken}`)).status).toBe(404);
      expect((await mitApp.app.request(`http://localhost:3000/api/freigabe/${oeffnenToken}`)).status).toBe(200);
      // „Öffnen mit …“ erscheint nicht in der Liste und lässt sich nicht widerrufen oder als Abruf zählen
      const [o] = await mitApp.sql`select id from freigaben where zweck = 'oeffnen'`;
      expect((await (await mitApp.anfrage(`/api/dokumente/${d.id}/links`, {}, cookie)).json()).length).toBe(1);
      await expect(mitApp.sql`insert into freigabe_abrufe (freigabe_id) values (${o!.id})`).rejects.toThrow(
        /geteilter Link/,
      );
    } finally {
      await mitApp.aufraeumen();
    }
  });
});
