import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("MCP gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let lesen: string;
  let schreiben: string;
  let nr = 0;

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const roh = (token: string, init: RequestInit = {}) =>
    t.app.request("/api/mcp", {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
  async function rpc(token: string, method: string, params?: unknown) {
    const res = await roh(token, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: ++nr, method, params }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }
  const aufruf = async (token: string, name: string, args: unknown) =>
    (await rpc(token, "tools/call", { name, arguments: args })).result;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const token = async (name: string, recht: string) =>
      (await (await t.anfrage("/api/tokens", json({ name, recht }), inhaber)).json()).klartext as string;
    lesen = await token("Assistent", "lesen");
    schreiben = await token("Ablage", "schreiben");
  });
  afterAll(() => t?.aufraeumen());

  it("handelt die Protokollversion aus und nennt Werkzeuge nach dem Recht des Tokens", async () => {
    const init = await rpc(lesen, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-03-26",
      serverInfo: { name: "belegt" },
      capabilities: { tools: {} },
    });
    expect((await rpc(lesen, "initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe(
      "2025-06-18",
    );

    const namen = async (token: string) =>
      (await rpc(token, "tools/list")).result.tools.map((w: { name: string }) => w.name).sort();
    expect(await namen(lesen)).toEqual(["dokument_lesen", "dokument_text", "dokumente_suchen", "ordnung_listen"]);
    expect(await namen(schreiben)).toEqual([
      "dokument_aufnehmen",
      "dokument_einordnen",
      "dokument_lesen",
      "dokument_ordnen",
      "dokument_text",
      "dokumente_suchen",
      "ordnung_listen",
    ]);
  });

  it("nimmt mit einem schreibenden Token auf, ordnet ein, und ein lesendes findet und liest es", async () => {
    const inhalt = Buffer.from("%PDF-1.7\n% Stromrechnung Oktober\n").toString("base64");
    const neu = await aufruf(schreiben, "dokument_aufnehmen", { dateiname: "strom-oktober.pdf", inhalt });
    expect(neu.isError).toBeUndefined();
    const id = neu.structuredContent.id as string;
    const [eintrag] = await t.sql`select actor from audit_log where table_name = 'dokumente' and row_id = ${id}`;
    expect(eintrag!.actor).toBe("token:Ablage");

    const e = await aufruf(schreiben, "dokument_einordnen", {
      id,
      art: "beleg",
      entstanden: "2026-10-31",
      titel: "Strom Oktober",
    });
    expect(e.structuredContent).toMatchObject({ art: "beleg", fristBis: "2034-12-31" });

    const treffer = await aufruf(lesen, "dokumente_suchen", { suche: "Strom Oktober" });
    expect(treffer.structuredContent.ergebnis).toEqual([
      expect.objectContaining({ id, art: "beleg", titel: "Strom Oktober", aufbewahrenBis: "2034-12-31" }),
    ]);
    const d = await aufruf(lesen, "dokument_lesen", { id });
    expect(d.structuredContent).toMatchObject({ id, dateiname: "strom-oktober.pdf", einordnung: { art: "beleg" } });
    expect(JSON.parse(d.content[0].text).id).toBe(id);
  });

  it("kennt Tags, Dokumenttyp, Felder und ASN; ein schreibendes Token ordnet zu, legt aber nichts an", async () => {
    const anlegen = async (pfad: string, body: object) =>
      (await (await t.anfrage(pfad, json(body), inhaber)).json()).id as string;
    const tag = await anlegen("/api/tags", { name: "Energie" });
    const typ = await anlegen("/api/dokumenttypen", { name: "Rechnung" });
    const summe = await anlegen("/api/felder", { name: "Summe", typ: "betrag" });
    const neu = await aufruf(schreiben, "dokument_aufnehmen", {
      dateiname: "gas-november.pdf",
      inhalt: Buffer.from("%PDF-1.7\n% Gas November\n").toString("base64"),
    });
    const id = neu.structuredContent.id as string;

    const ordnung = await aufruf(lesen, "ordnung_listen", {});
    expect(ordnung.structuredContent).toMatchObject({
      tags: [{ id: tag, name: "Energie" }],
      dokumenttypen: [{ id: typ, name: "Rechnung" }],
      felder: [{ id: summe, name: "Summe", typ: "betrag" }],
    });

    const gesetzt = await aufruf(schreiben, "dokument_ordnen", {
      id,
      tagsHinzu: [tag],
      dokumenttyp: typ,
      felder: [{ feldId: summe, wert: "1.234,56" }],
    });
    expect(gesetzt.isError).toBeUndefined();
    expect(gesetzt.structuredContent).toMatchObject({
      tags: [{ name: "Energie" }],
      dokumenttyp: { name: "Rechnung" },
      felder: [{ feldId: summe, wert: 123456 }],
    });
    const akteure = await t.sql`select distinct actor from audit_log
      where table_name in ('dokument_tags', 'dokument_dokumenttypen', 'feldwerte') and new_value ->> 'dokument_id' = ${id}`;
    expect(akteure.map((a) => a.actor)).toEqual(["token:Ablage"]);

    const d = await aufruf(lesen, "dokument_lesen", { id });
    expect(d.structuredContent).toMatchObject({
      asn: expect.any(Number),
      tags: [{ name: "Energie" }],
      dokumenttyp: { name: "Rechnung" },
      felder: [{ name: "Summe", typ: "betrag", wert: 123456 }],
    });
    const [treffer] = (await aufruf(lesen, "dokumente_suchen", { suche: "gas-november" })).structuredContent.ergebnis;
    expect(treffer).toMatchObject({
      id,
      asn: d.structuredContent.asn,
      tags: ["Energie"],
      dokumenttyp: "Rechnung",
    });

    // Entfernen geht, Unbekanntes und unpassende Werte sind Fehler des Werkzeugs, ein lesendes Token darf nicht
    const weg = await aufruf(schreiben, "dokument_ordnen", { id, tagsWeg: [tag], dokumenttyp: null });
    expect(weg.structuredContent).toMatchObject({ tags: [], dokumenttyp: null });
    const unbekannt = await aufruf(schreiben, "dokument_ordnen", {
      id,
      tagsHinzu: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(unbekannt.isError).toBe(true);
    const ungueltig = await aufruf(schreiben, "dokument_ordnen", { id, felder: [{ feldId: summe, wert: "zwölf" }] });
    expect(ungueltig.isError).toBe(true);
    expect((await aufruf(schreiben, "dokument_ordnen", { id })).isError).toBe(true);
    const verboten = await rpc(lesen, "tools/call", { name: "dokument_ordnen", arguments: { id, tagsHinzu: [tag] } });
    expect(verboten.error.code).toBe(-32602);
  });

  it("liefert Text in Stücken, bei Mails ihren Text", async () => {
    const form = new FormData();
    const eml =
      "From: a@example.org\r\nTo: b@example.org\r\nSubject: Angebot\r\nMessage-ID: <m@example.org>\r\n\r\nHallo, anbei das Angebot.\r\n";
    form.append("datei", new File([eml], "angebot.eml"));
    const { neu } = await (await t.anfrage("/api/mails", { method: "POST", body: form }, inhaber)).json();
    const text = await aufruf(lesen, "dokument_text", { id: neu[0], von: 7, laenge: 6 });
    expect(text.structuredContent).toMatchObject({ text: "anbei ", von: 7 });

    await inhalteErzeugen(t);
    const [pdf] = await t.sql`select id from dokumente where dateiname = 'strom-oktober.pdf'`;
    expect((await aufruf(lesen, "dokument_text", { id: pdf!.id })).structuredContent).toMatchObject({ von: 0 });
  });

  it("meldet Fehler des Werkzeugs als Ergebnis und verweigert Schreiben mit einem lesenden Token", async () => {
    const [d] = await t.sql`select id from dokumente limit 1`;
    const falsch = await aufruf(schreiben, "dokument_einordnen", { id: d!.id, art: "beleg", entstanden: "2026-02-30" });
    expect(falsch.isError).toBe(true);
    expect(falsch.content[0].text).toMatch(/2026-02-30/);
    const fehlt = await aufruf(lesen, "dokument_lesen", { id: "00000000-0000-4000-8000-000000000000" });
    expect(fehlt).toMatchObject({ isError: true, content: [{ text: "Kein Dokument mit dieser ID" }] });
    expect((await aufruf(lesen, "dokument_lesen", { id: "kaputt" })).isError).toBe(true);

    const verboten = await rpc(lesen, "tools/call", {
      name: "dokument_aufnehmen",
      arguments: { dateiname: "x", inhalt: "eA==" },
    });
    expect(verboten.error.code).toBe(-32602);
    expect((await rpc(lesen, "resources/list")).error.code).toBe(-32601);
  });

  it("hält sich an das Protokoll: Benachrichtigung, Stapel, GET, kaputtes JSON, ohne Token", async () => {
    expect(
      (
        await roh(lesen, {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        })
      ).status,
    ).toBe(202);
    expect(
      await (
        await roh(lesen, { method: "POST", body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]) })
      ).json(),
    ).toMatchObject({ error: { code: -32600 } });
    expect((await rpc(lesen, "ping")).result).toEqual({});
    expect((await roh(lesen)).status).toBe(405);
    expect((await roh(lesen, { method: "POST", body: "{kaputt" })).status).toBe(400);
    expect((await t.app.request("/api/mcp", json({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
  });

  it("antwortet auch bei einem unerwarteten Fehler mit JSON-RPC, ohne den Text der Datenbank", async () => {
    const neu = await aufruf(schreiben, "dokument_aufnehmen", {
      dateiname: "a\u0000b.pdf",
      inhalt: Buffer.from("%PDF-1.7\n% Steuerzeichen\n").toString("base64"),
    });
    expect(neu.isError).toBe(true);
    const [pdf] = await t.sql`select id from dokumente where dateiname = 'strom-oktober.pdf'`;
    // Postgres rechnet substr in integer; ein größerer Anfang ist kein Grund für einen HTTP-Fehler
    const weit = await aufruf(lesen, "dokument_text", { id: pdf!.id, von: 1e12 });
    expect(weit.isError).toBe(true);
    expect(JSON.stringify(weit)).not.toMatch(/integer|select/);
  });

  it("lehnt eine Anfrage mit id null ab (MCP: die ID ist nie null)", async () => {
    const res = await roh(lesen, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }),
    });
    expect(await res.json()).toMatchObject({ id: null, error: { code: -32600 } });
    const obj = await roh(lesen, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: {}, method: "ping" }) });
    expect(await obj.json()).toMatchObject({ id: null, error: { code: -32600 } });
  });
});
