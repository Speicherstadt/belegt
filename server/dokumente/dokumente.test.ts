import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Dokumente gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const app = { request: (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie) };

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  const pdf = new TextEncoder().encode("%PDF-1.7\n% erfundene Rechnung über 119,00 €\n");
  // Dieselbe Datei nimmt Belegt nur einmal auf (server/dokumente/doppelt.ts); jeder Test braucht also eine eigene
  const einzeln = (zusatz: string) => new TextEncoder().encode(`%PDF-1.7\n% erfundene Rechnung ${zusatz}\n`);

  async function hochladen(bytes: Uint8Array, name: string) {
    const form = new FormData();
    form.append("datei", new File([new Uint8Array(bytes)], name));
    return app.request("/api/dokumente", { method: "POST", body: form });
  }

  it("nimmt ein Original unverändert auf, mit Hash, Typ am Inhalt und Eintrag im Audit-Log", async () => {
    const res = await hochladen(pdf, "Rechnung-2026-11.pdf");
    expect(res.status).toBe(201);
    const dok = await res.json();
    expect(dok).toMatchObject({
      sha256: createHash("sha256").update(pdf).digest("hex"),
      groesse: pdf.byteLength,
      mimeType: "application/pdf",
      dateiname: "Rechnung-2026-11.pdf",
      quelle: "upload",
    });

    const datei = await app.request(`/api/dokumente/${dok.id}/datei`);
    expect(datei.status).toBe(200);
    expect(datei.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await datei.arrayBuffer())).toEqual(pdf);

    const [eintrag] =
      await t.sql`select actor, action from audit_log where table_name = 'dokumente' and row_id = ${dok.id}`;
    expect(eintrag).toEqual({ actor: "nutzer:anna@example.org", action: "INSERT" });
    expect(await t.sql`select 1 from seals where row_id = ${dok.id}`).toHaveLength(1);

    const { ereignisse, siegel } = await (await app.request(`/api/dokumente/${dok.id}/verlauf`)).json();
    expect(
      ereignisse.map((e: { tabelle: string; aktion: string; akteur: string }) => [e.tabelle, e.aktion, e.akteur]),
    ).toEqual([
      ["dokumente", "INSERT", "nutzer:anna@example.org"],
      ["seals", "INSERT", "nutzer:anna@example.org"],
    ]);
    expect(siegel).toMatch(/^[0-9a-f]{64}$/);
  });

  it("zeigt PDFs mit ?ansicht=1 im Browser an, anderes wird immer heruntergeladen", async () => {
    const pdfDok = await (await hochladen(einzeln("ansicht"), "ansicht.pdf")).json();
    expect(
      (await app.request(`/api/dokumente/${pdfDok.id}/datei?ansicht=1`)).headers.get("content-disposition"),
    ).toMatch(/^inline;/);
    expect((await app.request(`/api/dokumente/${pdfDok.id}/datei`)).headers.get("content-disposition")).toMatch(
      /^attachment;/,
    );
    const html = await (
      await hochladen(new TextEncoder().encode("<html><script>alert(1)</script></html>"), "x.html")
    ).json();
    const res = await app.request(`/api/dokumente/${html.id}/datei?ansicht=1`);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("kodiert den Dateinamen im Header nach RFC 8187, auch mit Klammern und Apostroph", async () => {
    const name = "Max's Rechnung (1) *.pdf";
    const dok = await (await hochladen(einzeln(name), name)).json();
    const header = (await app.request(`/api/dokumente/${dok.id}/datei`)).headers.get("content-disposition")!;
    const wert = header.match(/filename\*=UTF-8''(.*)$/)![1]!;
    // attr-char nach RFC 8187, Abschnitt 3.2.1; alles andere als %XX
    expect(wert).toMatch(/^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-F]{2})+$/);
    expect(decodeURIComponent(wert)).toBe(name);
  });

  it("lehnt Schreiben von einer fremden Seite ab, auch mit gültiger Sitzung (CSRF)", async () => {
    const form = new FormData();
    form.append("datei", new File([pdf], "untergeschoben.pdf"));
    const fremd = await app.request("/api/dokumente", {
      method: "POST",
      body: form,
      headers: { origin: "https://boese.example" },
    });
    expect(fremd.status).toBe(403);
    // Nachbar unter derselben Domain (andere Subdomain): Der Browser schickt das Cookie mit
    const nachbar = await app.request("/api/dokumente", {
      method: "POST",
      body: form,
      headers: { "sec-fetch-site": "same-site" },
    });
    expect(nachbar.status).toBe(403);
    expect(await t.sql`select 1 from dokumente where dateiname = 'untergeschoben.pdf'`).toHaveLength(0);
  });

  it("lehnt Ändern und Löschen eines Originals in der Datenbank ab", async () => {
    const dok = await (await hochladen(einzeln("fest"), "fest.pdf")).json();
    await expect(t.sql`update dokumente set dateiname = 'anders.pdf' where id = ${dok.id}`).rejects.toThrow(
      /darf nur ergänzt werden/,
    );
    await expect(t.sql`delete from dokumente where id = ${dok.id}`).rejects.toThrow(/darf nur ergänzt werden/);
  });

  it("liefert eine veränderte Datei nicht aus", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n% wird gleich verändert\n");
    const dok = await (await hochladen(bytes, "verändert.pdf")).json();
    await writeFile(t.speicher.pfad(dok.sha256), "manipuliert");
    const res = await app.request(`/api/dokumente/${dok.id}/datei`);
    expect(res.status).toBe(409);
  });

  it("listet die neuesten zuerst und sucht im Dateinamen, auch mit Sonderzeichen", async () => {
    await hochladen(new TextEncoder().encode("eins"), "Vertrag_100%.txt");
    await hochladen(new TextEncoder().encode("zwei"), "Notiz.txt");
    const alle = await (await app.request("/api/dokumente")).json();
    expect(alle[0].dateiname).toBe("Notiz.txt");
    const treffer = await (await app.request(`/api/dokumente?suche=${encodeURIComponent("_100%")}`)).json();
    expect(treffer.map((d: { dateiname: string }) => d.dateiname)).toEqual(["Vertrag_100%.txt"]);
  });

  it("begrenzt limit auf 1 bis 200, auch bei negativen und kaputten Werten", async () => {
    for (const limit of ["-5", "0", "abc", "1e9", "2.5"])
      expect((await app.request(`/api/dokumente?limit=${limit}`)).status, limit).toBe(200);
  });

  it("antwortet bei fehlender Datei, unbekannter und ungültiger ID passend", async () => {
    expect((await app.request("/api/dokumente", { method: "POST", body: new FormData() })).status).toBe(400);
    expect((await app.request("/api/dokumente/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await app.request("/api/dokumente/keine-id")).status).toBe(404);
  });

  it("lässt Steuerberatung und Prüfer lesen, aber nicht hochladen", async () => {
    await t.sql`update "user" set role = 'steuerberatung' where email = 'anna@example.org'`;
    try {
      expect((await app.request("/api/dokumente")).status).toBe(200);
      expect((await hochladen(pdf, "verboten.pdf")).status).toBe(403);
    } finally {
      await t.sql`update "user" set role = 'inhaber' where email = 'anna@example.org'`;
    }
  });

  it("prüft auf Wunsch jede Datei gegen ihren Hash und meldet fehlende und veränderte", async () => {
    const ok = await (await app.request("/api/pruefung?dateien=1")).json();
    const vorher = ok.befunde.filter((b: { art: string }) => b.art === "datei").length;
    expect(ok.dateienGeprueft).toBeGreaterThan(0);
    const weg = await (await hochladen(new TextEncoder().encode("wird gelöscht"), "weg.pdf")).json();
    const anders = await (await hochladen(new TextEncoder().encode("wird verändert"), "anders.pdf")).json();
    await rm(t.speicher.pfad(weg.sha256));
    await writeFile(t.speicher.pfad(anders.sha256), "verändert");
    const ergebnis = await (await app.request("/api/pruefung?dateien=1")).json();
    const datei = ergebnis.befunde.filter((b: { art: string }) => b.art === "datei");
    expect(datei).toHaveLength(vorher + 2);
    expect(datei).toContainEqual(expect.objectContaining({ zeile: weg.id, befund: "Datei fehlt" }));
    expect(datei).toContainEqual(
      expect.objectContaining({ zeile: anders.id, befund: "Datei passt nicht zu ihrem Hash" }),
    );
    expect(
      (await (await app.request("/api/pruefung")).json()).befunde.filter((b: { art: string }) => b.art === "datei"),
    ).toEqual([]);
  });

  it("nennt im Bericht den Prüfwert der Kette und die Zahl der geprüften Zeilen", async () => {
    const { bericht } = await (await app.request("/api/pruefung")).json();
    const [kopf] = await t.sql`select seq, encode(hash, 'hex') as hash from audit_chain`;
    const [z] = await t.sql`select (select count(*) from dokumente)::int as d, (select count(*) from seals)::int as s,
                                   (select count(*) from audit_log)::int as p`;
    expect(bericht).toMatchObject({ dokumente: z!.d, siegel: z!.s, protokoll: z!.p });
    expect(bericht.pruefwert).toContain(kopf!.hash);
    expect(bericht.pruefwert).toContain(String(kopf!.seq));
    expect(Date.parse(bericht.zeitpunkt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("meldet eine gültige Kette und findet eine an den Triggern vorbei geänderte Zeile", async () => {
    expect(await (await app.request("/api/pruefung")).json()).toMatchObject({ ok: true, befunde: [] });
    const dok = await (await hochladen(einzeln("später"), "später-geändert.pdf")).json();
    await t.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update dokumente set dateiname = 'gefälscht.pdf' where id = ${dok.id}`;
    });
    const ergebnis = await (await app.request("/api/pruefung")).json();
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.befunde).toContainEqual(
      expect.objectContaining({ art: "siegel", tabelle: "dokumente", zeile: dok.id }),
    );
  });
});
