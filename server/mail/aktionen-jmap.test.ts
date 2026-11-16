import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { aktionenAusfuehren } from "./aktionen-ausfuehren.ts";
import { mailRoh } from "./test-postfach.ts";

/*
 * Aktionen nach dem Abholen über JMAP gegen einen nachgebauten Server über HTTP (node:http, Port vom System): Email/set
 * mit keywords, mailboxIds und destroy nach RFC 8621, 4.6; Email/get meldet unbekannte IDs in notFound.
 */
interface Mail {
  blob: Uint8Array;
  mailboxIds: Record<string, true>;
  keywords: Record<string, true>;
}

function jmapServer() {
  const zustand = {
    mails: new Map<string, Mail>(),
    stand: 1,
    log: [] as { stand: number; id: string }[],
    sets: [] as unknown[],
    /** Email/set lehnt Änderungen mit diesem Typ ab */
    ablehnen: null as string | null,
  };
  const mailboxen = [
    { id: "posteingang", name: "Posteingang", role: "inbox" },
    { id: "archiv", name: "Archiv", role: "archive" },
    { id: "wichtig", name: "Wichtig", role: null },
    // Gleichnamige Ordner unter verschiedenen Eltern (RFC 8621, 2: eindeutig nur unter Geschwistern)
    { id: "projekte", name: "Projekte", role: null },
    { id: "projekte-archiv", name: "Archiv", role: null, parentId: "projekte" },
    { id: "ablage", name: "Ablage", role: "trash" },
  ];
  const anlegen = (id: string, blob: Uint8Array, weitere: string[] = []) => {
    const mailboxIds: Record<string, true> = { posteingang: true };
    for (const w of weitere) mailboxIds[w] = true;
    zustand.mails.set(id, { blob, mailboxIds, keywords: {} });
    zustand.log.push({ stand: ++zustand.stand, id });
  };
  const antworten = (name: string, a: Record<string, unknown>) => {
    if (name === "Mailbox/get") return { list: mailboxen };
    if (name === "Email/get") {
      const ids = a.ids as string[];
      return {
        state: String(zustand.stand),
        list: ids
          .filter((i) => zustand.mails.has(i))
          .map((i) => ({ id: i, blobId: i, mailboxIds: zustand.mails.get(i)!.mailboxIds })),
        notFound: ids.filter((i) => !zustand.mails.has(i)),
      };
    }
    if (name === "Email/query") {
      const ids = [...zustand.mails]
        .filter(([, m]) => m.mailboxIds[(a.filter as { inMailbox: string }).inMailbox])
        .map(([i]) => i);
      return { ids, position: 0, total: ids.length };
    }
    if (name === "Email/changes") {
      const neu = zustand.log.filter((l) => l.stand > Number(a.sinceState)).map((l) => l.id);
      return { created: neu, updated: [], destroyed: [], newState: String(zustand.stand), hasMoreChanges: false };
    }
    if (name === "Email/set") {
      zustand.sets.push({ update: a.update, destroy: a.destroy });
      const updated: Record<string, null> = {};
      const notUpdated: Record<string, { type: string }> = {};
      for (const [id, patch] of Object.entries((a.update ?? {}) as Record<string, Record<string, unknown>>)) {
        const m = zustand.mails.get(id);
        if (!m || zustand.ablehnen) {
          notUpdated[id] = { type: zustand.ablehnen ?? "notFound" };
          continue;
        }
        for (const [pfad, wert] of Object.entries(patch)) {
          const [feld, schluessel] = pfad.split("/") as ["keywords" | "mailboxIds", string];
          if (wert === true) m[feld][schluessel] = true;
          else delete m[feld][schluessel];
        }
        updated[id] = null;
      }
      const destroyed: string[] = [];
      const notDestroyed: Record<string, { type: string }> = {};
      for (const id of (a.destroy ?? []) as string[]) {
        if (zustand.mails.delete(id)) destroyed.push(id);
        else notDestroyed[id] = { type: "notFound" };
      }
      return { updated, notUpdated, destroyed, notDestroyed };
    }
    throw new Error(`unbekannt: ${name}`);
  };
  const server: Server = createServer(async (req, res) => {
    const teile: Buffer[] = [];
    for await (const t of req) teile.push(t as Buffer);
    if (req.headers.authorization !== `Basic ${Buffer.from("anna:geheim").toString("base64")}`) {
      res.writeHead(401).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    const senden = (daten: unknown) =>
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(daten));
    if (url.pathname === "/.well-known/jmap")
      return senden({
        apiUrl: "/jmap/api",
        downloadUrl: "/jmap/download/{accountId}/{blobId}/{name}?type={type}",
        primaryAccounts: { "urn:ietf:params:jmap:mail": "konto1" },
      });
    if (url.pathname.startsWith("/jmap/download/konto1/")) {
      const m = zustand.mails.get(decodeURIComponent(url.pathname.split("/")[4]!));
      if (!m) return res.writeHead(404).end();
      return res.writeHead(200).end(Buffer.from(m.blob));
    }
    const { methodCalls } = JSON.parse(Buffer.concat(teile).toString()) as {
      methodCalls: [string, Record<string, unknown>, string][];
    };
    senden({ methodResponses: methodCalls.map(([name, a, id]) => [name, antworten(name, a), id]) });
  });
  return { zustand, anlegen, server };
}

describe.skipIf(!testDatenbankUrl)("Aktionen im Postfach über JMAP", () => {
  const j = jmapServer();
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  let port: number;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const json = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  async function quelle(name: string) {
    const res = await anfrage(
      "/api/quellen",
      json({ name, art: "jmap", host: "127.0.0.1", port, tls: false, benutzer: "anna", passwort: "geheim" }),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }
  const einstellen = (id: string, aktion: Record<string, unknown>) =>
    anfrage(`/api/quellen/${id}/aktion`, json(aktion));
  const abholen = async (id: string) => (await anfrage(`/api/quellen/${id}/abrufen`, { method: "POST" })).json();
  const keinImap = async () => {
    throw new Error("kein IMAP");
  };
  const ausfuehren = (id: string, jetzt = new Date()) =>
    aktionenAusfuehren({ db: t.db, speicher: t.speicher }, t.schluessel, id, keinImap, { jetzt });

  beforeAll(async () => {
    await new Promise<void>((fertig) => j.server.listen(0, "127.0.0.1", fertig));
    port = (j.server.address() as AddressInfo).port;
    t = await testApp({ oeffnen: keinImap });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await new Promise((fertig) => j.server.close(fertig));
  });

  it("markiert als gelesen und mit Flagge über Schlüsselwörter, einmal je Mail", async () => {
    const id = await quelle("jmap-gelesen");
    await einstellen(id, { aktion: "gelesen" });
    j.anlegen("m1", mailRoh(1, "jmap-aktion"));
    expect(await abholen(id)).toEqual({ neu: 1, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(j.zustand.mails.get("m1")!.keywords).toEqual({ $seen: true });
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(j.zustand.sets).toEqual([{ update: { m1: { "keywords/$seen": true } }, destroy: undefined }]);

    await einstellen(id, { aktion: "markieren" });
    j.anlegen("m2", mailRoh(2, "jmap-aktion"));
    await abholen(id);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(j.zustand.mails.get("m2")!.keywords).toEqual({ $flagged: true });
    const [e] =
      await t.sql`select jmap_id, uid from postfach_aktionen where quelle_id = ${id} order by zeit desc limit 1`;
    expect(e).toEqual({ jmap_id: "m2", uid: null });
  });

  it("verschiebt in einen Ordner, den es gibt, und lässt andere Ordner der Mail stehen", async () => {
    j.zustand.mails.clear();
    const id = await quelle("jmap-verschieben");
    expect(await (await anfrage(`/api/quellen/${id}/ordner`)).json()).toEqual({
      ordner: [
        { id: "posteingang", pfad: "Posteingang", papierkorb: false },
        { id: "archiv", pfad: "Archiv", papierkorb: false },
        { id: "wichtig", pfad: "Wichtig", papierkorb: false },
        { id: "projekte", pfad: "Projekte", papierkorb: false },
        { id: "projekte-archiv", pfad: "Projekte/Archiv", papierkorb: false },
        { id: "ablage", pfad: "Ablage", papierkorb: true },
      ],
    });
    expect((await einstellen(id, { aktion: "verschieben", ziel: "gibtesnicht" })).status).toBe(400);
    // Der Name allein reicht nicht, gewählt wird über die Mailbox-ID
    expect((await einstellen(id, { aktion: "verschieben", ziel: "Archiv" })).status).toBe(400);
    // Die Mailbox mit der Rolle trash ist ein Papierkorb: Verschieben dorthin ist Löschen
    expect((await einstellen(id, { aktion: "verschieben", ziel: "ablage" })).status).toBe(400);
    expect((await einstellen(id, { aktion: "verschieben", ziel: "archiv" })).status).toBe(200);
    j.anlegen("m3", mailRoh(3, "jmap-aktion"), ["wichtig"]);
    await abholen(id);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(j.zustand.mails.get("m3")!.mailboxIds).toEqual({ wichtig: true, archiv: true });
  });

  it("wählt den Zielordner über seine ID, auch wenn es den Namen mehrfach gibt", async () => {
    j.zustand.mails.clear();
    const id = await quelle("jmap-gleichnamig");
    const { ordner } = await (await anfrage(`/api/quellen/${id}/ordner`)).json();
    expect(ordner).toContainEqual(expect.objectContaining({ id: "projekte-archiv", pfad: "Projekte/Archiv" }));
    expect(ordner).toContainEqual(expect.objectContaining({ id: "archiv", pfad: "Archiv" }));
    expect((await einstellen(id, { aktion: "verschieben", ziel: "projekte-archiv" })).status).toBe(200);
    j.anlegen("m10", mailRoh(10, "jmap-aktion"));
    await abholen(id);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(j.zustand.mails.get("m10")!.mailboxIds).toEqual({ "projekte-archiv": true });
    const [e] = await t.sql`select ziel from postfach_aktionen where quelle_id = ${id}`;
    expect(e!.ziel).toBe("Projekte/Archiv");
  });

  it("hält eine abgelehnte Änderung als Fehler fest und lässt eine verschwundene Mail aus", async () => {
    j.zustand.mails.clear();
    const id = await quelle("jmap-fehler");
    await einstellen(id, { aktion: "markieren" });
    j.anlegen("m4", mailRoh(4, "jmap-aktion"));
    j.anlegen("m5", mailRoh(5, "jmap-aktion"));
    await abholen(id);
    j.zustand.mails.delete("m5");
    j.zustand.ablehnen = "forbidden";
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 1, fehler: 1 });
    j.zustand.ablehnen = null;
    const fehler = await t.sql`select meldung from postfach_aktionen where quelle_id = ${id} and ergebnis = 'fehler'`;
    expect(fehler).toEqual([{ meldung: "JMAP: forbidden" }]);
    expect(await ausfuehren(id, new Date(Date.now() + 3_600_000))).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
  });

  it("löscht mit destroy erst nach der Wartezeit und nur bei gleichem Inhalt", async () => {
    j.zustand.mails.clear();
    const id = await quelle("jmap-loeschen");
    await einstellen(id, { aktion: "loeschen", warteStunden: 24, loeschenBestaetigt: true });
    j.anlegen("m6", mailRoh(6, "jmap-aktion"));
    j.anlegen("m7", mailRoh(7, "jmap-aktion"));
    await abholen(id);
    // m7 hat danach im Postfach einen anderen Inhalt als das Original im Archiv: bleibt stehen
    j.zustand.mails.get("m7")!.blob = mailRoh(8, "jmap-aktion");
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(j.zustand.mails.has("m6")).toBe(true);
    expect(await ausfuehren(id, new Date(Date.now() + 25 * 3_600_000))).toEqual({
      ausgefuehrt: 1,
      entfallen: 0,
      fehler: 1,
    });
    expect(j.zustand.mails.has("m6")).toBe(false);
    expect(j.zustand.mails.has("m7")).toBe(true);
    expect(j.zustand.sets.at(-1)).toEqual({ update: undefined, destroy: ["m6"] });
  });

  it("nimmt beim Löschen eine Mail, die auch in anderen Ordnern liegt, nur aus dem abgeholten Ordner", async () => {
    j.zustand.mails.clear();
    const id = await quelle("jmap-loeschen-mehrere");
    await einstellen(id, { aktion: "loeschen", warteStunden: 1, loeschenBestaetigt: true });
    j.anlegen("m9", mailRoh(9, "jmap-aktion"), ["wichtig"]);
    await abholen(id);
    expect(await ausfuehren(id, new Date(Date.now() + 2 * 3_600_000))).toEqual({
      ausgefuehrt: 1,
      entfallen: 0,
      fehler: 0,
    });
    expect(j.zustand.mails.get("m9")?.mailboxIds).toEqual({ wichtig: true });
    expect(j.zustand.sets.at(-1)).toEqual({ update: { m9: { "mailboxIds/posteingang": null } }, destroy: undefined });
  });
});
