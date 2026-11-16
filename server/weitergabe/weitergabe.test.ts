import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { workflowsAusfuehren } from "../workflows/ausfuehren.ts";
import { platzhalterErsetzen, voruebergehend, weitergeben } from "./weitergabe.ts";

/** Ein nachgebauter Empfänger: merkt sich jede Anfrage mit Kopfzeilen und Formular, antwortet nach antwort */
async function empfaenger(antwort: (n: number) => Response = () => new Response("{}", { status: 201 })) {
  const anfragen: { kopf: Headers; form: FormData; pfad: string }[] = [];
  const server: Server = createServer(async (req, res) => {
    const teile: Buffer[] = [];
    for await (const t of req) teile.push(t as Buffer);
    const kopf = new Headers(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
    const form = await new Request("http://x", {
      method: "POST",
      headers: kopf,
      body: Buffer.concat(teile),
    }).formData();
    anfragen.push({ kopf, form, pfad: req.url ?? "" });
    const r = antwort(anfragen.length);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, anfragen, stoppen: () => server.close() };
}

describe("Platzhalter und Wiederholung", () => {
  const a = {
    id: "d1",
    asn: 42,
    dateiname: "rechnung.pdf",
    titel: null,
    datum: "2026-10-01",
    eingang: "2026-10-02",
    art: "beleg",
    korrespondent: "Stadtwerke",
    dokumenttyp: null,
    url: "https://belegt.example/dokumente/d1",
  };
  it("setzt die Angaben ein, ohne Titel den Dateinamen, und lässt Unbekanntes stehen", () => {
    expect(platzhalterErsetzen("ASN {asn}: {titel} vom {datum} ({korrespondent}) {unbekannt} {url}", a)).toBe(
      "ASN 42: rechnung.pdf vom 2026-10-01 (Stadtwerke) {unbekannt} https://belegt.example/dokumente/d1",
    );
  });
  it("versucht es bei Ausfällen wieder, nicht bei Weiterleitung oder Ablehnung", () => {
    expect([null, 408, 429, 500, 503].map(voruebergehend)).toEqual([true, true, true, true, true]);
    expect([301, 302, 400, 401, 403, 404, 409, 422].map(voruebergehend)).toEqual(Array(8).fill(false));
  });
});

describe.skipIf(!testDatenbankUrl)("Original an Adresse senden gegen Postgres", { timeout: 60_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const als = (cookie: string, pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const hochladen = async (name: string, inhalt = `Inhalt ${name}`) => {
    const f = new FormData();
    f.append("datei", new File([new TextEncoder().encode(inhalt)], name));
    return (await (await als(inhaber, "/api/dokumente", { method: "POST", body: f })).json()) as {
      id: string;
      asn: number;
    };
  };
  const workflow = async (name: string, senden: Record<string, unknown>) => {
    const res = await als(
      inhaber,
      "/api/workflows",
      json({
        name,
        ausloeser: "eingang",
        bedingungen: { dateinameEnthaelt: name },
        aktionen: [{ art: "senden", ...senden }],
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: string; aktionen: unknown[] };
  };
  const lauf = async () => {
    await workflowsAusfuehren(t.db, { ocr: false });
    return weitergeben(t, { schluessel: t.schluessel, basisUrl: "https://belegt.example" });
  };
  const weitergabenVon = async (id: string) =>
    (await (await als(inhaber, `/api/dokumente/${id}/weitergaben`)).json()) as {
      stand: string;
      httpStatus: number | null;
      fehler: string | null;
      versuche: number;
      gesendetAm: string | null;
      ziel: string | null;
    }[];
  /** Den nächsten Versuch vorziehen, statt Minuten zu warten */
  const jetztFaellig = () => t.sql`update weitergaben set naechster_versuch = now() where stand = 'offen'`;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("sendet an zwei Empfänger mit eigenem Dateifeld, eigener Kopfzeile und festen Feldern, jeden genau einmal", async () => {
    // Wie eine Buchhaltung mit Belege-API: Feld datei, Bearer-Token, Referenz auf das Dokument
    const buchhaltung = await empfaenger();
    // Wie ein anderes Archiv: Feld document, „Token …“, erst ein Ausfall, dann angenommen
    const archiv = await empfaenger((n) => new Response("", { status: n === 1 ? 503 : 200 }));
    await workflow("beleg-a", {
      url: `${buchhaltung.url}/api/v1/belege`,
      dateifeld: "datei",
      kopfzeile: { name: "Authorization", wert: "Bearer hb_geheim_123" },
      felder: [
        { name: "externalSource", wert: "belegt" },
        { name: "externalId", wert: "{id}" },
        { name: "note", wert: "ASN {asn}: {titel} {url}" },
      ],
    });
    // Trifft dasselbe Dokument: beleg-a2.pdf enthält beide Namen
    await workflow("beleg-a2", {
      url: `${archiv.url}/api/documents/post_document/`,
      dateifeld: "document",
      kopfzeile: { name: "Authorization", wert: "Token abc-geheim" },
      felder: [{ name: "title", wert: "{titel}" }],
    });
    const d = await hochladen("beleg-a2.pdf", "%PDF-1.7 Rechnung beleg-a");

    expect(await lauf()).toEqual({ gesendet: 1, fehler: 1 });
    expect(buchhaltung.anfragen).toHaveLength(1);
    const b = buchhaltung.anfragen[0]!;
    expect(b.pfad).toBe("/api/v1/belege");
    expect(b.kopf.get("authorization")).toBe("Bearer hb_geheim_123");
    expect(b.form.get("externalSource")).toBe("belegt");
    expect(b.form.get("externalId")).toBe(d.id);
    expect(b.form.get("note")).toBe(`ASN ${d.asn}: beleg-a2.pdf https://belegt.example/dokumente/${d.id}`);
    const datei = b.form.get("datei") as File;
    expect(datei.name).toBe("beleg-a2.pdf");
    expect(await datei.text()).toBe("%PDF-1.7 Rechnung beleg-a");

    // Das Archiv antwortete 503: später noch einmal, dann angenommen
    let stand = await weitergabenVon(d.id);
    expect(stand.map((w) => [w.stand, w.httpStatus])).toEqual(
      expect.arrayContaining([
        ["gesendet", 201],
        ["offen", 503],
      ]),
    );
    expect(await lauf()).toEqual({ gesendet: 0, fehler: 0 });
    await jetztFaellig();
    expect(await lauf()).toEqual({ gesendet: 1, fehler: 0 });
    const a = archiv.anfragen.at(-1)!;
    expect(a.kopf.get("authorization")).toBe("Token abc-geheim");
    expect(a.form.get("title")).toBe("beleg-a2.pdf");
    expect(await (a.form.get("document") as File).text()).toBe("%PDF-1.7 Rechnung beleg-a");
    stand = await weitergabenVon(d.id);
    expect(stand.every((w) => w.stand === "gesendet" && w.gesendetAm)).toBe(true);
    expect(stand.find((w) => w.httpStatus === 200)).toMatchObject({ versuche: 2, fehler: null });

    // Nichts zweimal: weitere Läufe senden nichts, und Postgres hält eine gesendete Weitergabe fest
    await jetztFaellig();
    expect(await lauf()).toEqual({ gesendet: 0, fehler: 0 });
    await expect(
      t.sql`update weitergaben set stand = 'offen', gesendet_am = null where dokument_id = ${d.id}`,
    ).rejects.toThrow(/schon gesendet/);
    expect(buchhaltung.anfragen).toHaveLength(1);
    expect(archiv.anfragen).toHaveLength(2);
    buchhaltung.stoppen();
    archiv.stoppen();
  });

  it("speichert den Wert der Kopfzeile nur verschlüsselt: nie in der Antwort, im Workflow oder im Audit-Log", async () => {
    const w = await workflow("geheim-b", {
      url: "http://127.0.0.1:9/belege",
      dateifeld: "datei",
      kopfzeile: { name: "X-Api-Key", wert: "sehr-geheimer-schluessel" },
    });
    expect(JSON.stringify(w)).not.toContain("sehr-geheimer-schluessel");
    expect(w.aktionen).toEqual([
      {
        art: "senden",
        url: "http://127.0.0.1:9/belege",
        dateifeld: "datei",
        kopfzeile: { name: "X-Api-Key", gesetzt: true },
        felder: [],
      },
    ]);
    expect(JSON.stringify(await (await als(inhaber, "/api/workflows")).json())).not.toContain("sehr-geheimer");
    const im = await t.sql`select count(*)::int as n from audit_log where new_value::text like '%sehr-geheimer%'
                            or old_value::text like '%sehr-geheimer%'`;
    expect(im[0]!.n).toBe(0);
    const [g] = await t.sql`select ciphertext from workflow_geheimnisse where workflow_id = ${w.id}`;
    expect(Buffer.from(g!.ciphertext).toString("latin1")).not.toContain("sehr-geheimer");
  });

  it("lehnt Zugangsdaten in der Adresse, Kopfzeilen der Verbindung und eine Kopfzeile ohne Wert ab", async () => {
    for (const senden of [
      { url: "http://nutzer:pw@empfaenger.example/x", dateifeld: "datei" },
      { url: "ftp://empfaenger.example/x", dateifeld: "datei" },
      { url: "http://empfaenger.example/x", dateifeld: "datei", kopfzeile: { name: "Host", wert: "x" } },
      { url: "http://empfaenger.example/x", dateifeld: "datei", kopfzeile: { name: "Authorization" } },
      { url: "http://empfaenger.example/x", dateifeld: "da tei" },
    ]) {
      const res = await als(
        inhaber,
        "/api/workflows",
        json({ name: `falsch-${Math.random()}`, ausloeser: "eingang", aktionen: [{ art: "senden", ...senden }] }),
      );
      expect(res.status, JSON.stringify(senden)).toBe(400);
    }
  });

  it("folgt keiner Weiterleitung und gibt bei einer Ablehnung (4xx) sofort auf", async () => {
    const ziel = await empfaenger();
    const weiter = await empfaenger(
      () => new Response(null, { status: 302, headers: { location: `${ziel.url}/fremd` } }),
    );
    const ablehnung = await empfaenger(() => new Response("kaputt", { status: 400 }));
    await workflow("weiter-c", { url: weiter.url, dateifeld: "datei" });
    await workflow("ablehnung-c", { url: ablehnung.url, dateifeld: "datei" });
    const d1 = await hochladen("weiter-c.pdf");
    const d2 = await hochladen("ablehnung-c.pdf");
    await lauf();
    expect((await weitergabenVon(d1.id))[0]).toMatchObject({
      stand: "fehlgeschlagen",
      httpStatus: 302,
      fehler: "Weiterleitung (302), nicht gefolgt",
    });
    expect(ziel.anfragen).toHaveLength(0);
    expect((await weitergabenVon(d2.id))[0]).toMatchObject({
      stand: "fehlgeschlagen",
      httpStatus: 400,
      fehler: "Antwort 400",
    });
    await jetztFaellig();
    await lauf();
    expect(ablehnung.anfragen).toHaveLength(1);
    for (const e of [ziel, weiter, ablehnung]) e.stoppen();
  });

  it("sendet ohne Antwort später wieder, gibt nach allen Versuchen auf und lässt Gelöschtes entfallen", async () => {
    await workflow("tot-d", { url: "http://127.0.0.1:9/nichts", dateifeld: "datei" });
    const d = await hochladen("tot-d.pdf");
    await lauf();
    let [w] = await weitergabenVon(d.id);
    expect(w).toMatchObject({ stand: "offen", httpStatus: null, versuche: 1 });
    for (let i = 0; i < 8; i++) {
      await jetztFaellig();
      await lauf();
    }
    [w] = await weitergabenVon(d.id);
    expect(w).toMatchObject({ stand: "fehlgeschlagen", versuche: 9 });

    const e = await empfaenger();
    await workflow("weg-d", { url: e.url, dateifeld: "datei" });
    const weg = await hochladen("weg-d.pdf");
    await workflowsAusfuehren(t.db, { ocr: false });
    await als(inhaber, `/api/dokumente/${weg.id}/einordnung`, json({ art: "frei", entstanden: "2026-11-01" }));
    await als(inhaber, `/api/dokumente/${weg.id}/loeschung`, { method: "POST" });
    await weitergeben(t, { schluessel: t.schluessel, basisUrl: "https://belegt.example" });
    expect((await weitergabenVon(weg.id))[0]).toMatchObject({ stand: "entfallen", fehler: "Dokument gelöscht" });
    expect(e.anfragen).toHaveLength(0);
    e.stoppen();
  });

  it("zeigt Weitergaben Inhaber und Steuerberatung, nicht Mitarbeitern", async () => {
    const d = await hochladen("sicht-e.pdf");
    const steuer = await zugangAnlegen(t, inhaber, "stb@example.org", { rolle: "steuerberatung" });
    const mitarbeiter = await zugangAnlegen(t, inhaber, "max@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: {},
    });
    expect((await als(steuer, `/api/dokumente/${d.id}/weitergaben`)).status).toBe(200);
    expect((await als(mitarbeiter, `/api/dokumente/${d.id}/weitergaben`)).status).toBe(403);
  });
});
