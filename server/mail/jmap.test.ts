import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { abrufen } from "./abruf.ts";
import { jmapHolen } from "./jmap.ts";

const roh = (n: number) =>
  new TextEncoder().encode(
    [
      `From: kunde@kunde.de`,
      "To: anna@example.org",
      `Subject: JMAP ${n}`,
      `Message-ID: <jmap-${n}@kunde.de>`,
      "",
      `Text ${n}`,
    ].join("\r\n"),
  );

/** Nachgebauter JMAP-Server (RFC 8620/8621) mit den Methoden, die Belegt nutzt */
function jmapServer({
  sitzung = {},
  hoechstens = Number.POSITIVE_INFINITY,
}: {
  /** Ersetzt Angaben der Sitzung, etwa apiUrl */
  sitzung?: Record<string, unknown>;
  /** Größte Seite, die der Server bei Email/query liefert (RFC 8620, 5.5: er darf limit kürzen) */
  hoechstens?: number;
} = {}) {
  const zustand = {
    /** Adressen, an die Zugangsdaten gingen */
    mitZugang: [] as string[],
    /** Liefert Email/get einmal einen Fehler statt der Mails */
    getFehler: false,
    stand: 1,
    mails: new Map<string, { blob: Uint8Array; ordner: string }>(),
    // Änderungen je Stand: welche IDs angelegt oder verschoben wurden
    log: [] as { stand: number; id: string; art: "created" | "updated" }[],
    keineAenderungen: false,
    aufrufe: [] as string[],
    auth: "" as string,
  };
  const anlegen = (id: string, n: number, ordner = "posteingang") => {
    zustand.mails.set(id, { blob: roh(n), ordner });
    zustand.log.push({ stand: ++zustand.stand, id, art: "created" });
  };
  const verschieben = (id: string, ordner: string) => {
    zustand.mails.get(id)!.ordner = ordner;
    zustand.log.push({ stand: ++zustand.stand, id, art: "updated" });
  };
  const json = (daten: unknown) =>
    new Response(JSON.stringify(daten), { headers: { "content-type": "application/json" } });
  const abfragen = async (url: string, init: RequestInit) => {
    zustand.auth = (init.headers as Record<string, string>).authorization ?? "";
    if (zustand.auth) zustand.mitZugang.push(url);
    if (zustand.auth !== `Basic ${Buffer.from("anna:geheim").toString("base64")}`)
      return new Response(null, { status: 401 });
    const u = new URL(url);
    if (u.pathname === "/.well-known/jmap")
      return json({
        apiUrl: "/jmap/api",
        downloadUrl: "/jmap/download/{accountId}/{blobId}/{name}?type={type}",
        primaryAccounts: { "urn:ietf:params:jmap:mail": "konto1" },
        ...sitzung,
      });
    if (u.pathname.startsWith("/jmap/download/konto1/")) {
      const id = decodeURIComponent(u.pathname.split("/")[4]!);
      return new Response(new Uint8Array(zustand.mails.get(id)!.blob));
    }
    const { methodCalls } = JSON.parse(String(init.body)) as {
      methodCalls: [string, Record<string, unknown>, string][];
    };
    return json({
      methodResponses: methodCalls.map(([name, a, id]) => {
        zustand.aufrufe.push(name);
        if (name === "Mailbox/get")
          return [
            name,
            {
              list: [
                { id: "posteingang", name: "Posteingang", role: "inbox" },
                { id: "spam", name: "Spam", role: "junk" },
              ],
            },
            id,
          ];
        if (name === "Email/get" && zustand.getFehler && (a.ids as string[]).length) {
          zustand.getFehler = false;
          return ["error", { type: "requestTooLarge" }, id];
        }
        if (name === "Email/get") {
          const ids = a.ids as string[];
          return [
            name,
            {
              state: String(zustand.stand),
              list: ids
                .filter((i) => zustand.mails.has(i))
                .map((i) => ({ id: i, blobId: i, mailboxIds: { [zustand.mails.get(i)!.ordner]: true } })),
            },
            id,
          ];
        }
        if (name === "Email/query") {
          const alle = [...zustand.mails]
            .filter(([, m]) => m.ordner === (a.filter as { inMailbox: string }).inMailbox)
            .map(([i]) => i);
          const limit = Math.min(a.limit as number, hoechstens);
          const position = a.position as number;
          return [name, { ids: alle.slice(position, position + limit), position, limit, total: alle.length }, id];
        }
        if (name === "Email/changes") {
          if (zustand.keineAenderungen) return ["error", { type: "cannotCalculateChanges" }, id];
          const seit = Number(a.sinceState);
          const neu = zustand.log.filter((l) => l.stand > seit);
          return [
            name,
            {
              created: neu.filter((l) => l.art === "created").map((l) => l.id),
              updated: neu.filter((l) => l.art === "updated").map((l) => l.id),
              newState: String(zustand.stand),
              hasMoreChanges: false,
            },
            id,
          ];
        }
        return ["error", { type: "unknownMethod" }, id];
      }),
    });
  };
  return { zustand, anlegen, verschieben, abfragen };
}

describe.skipIf(!testDatenbankUrl)("JMAP-Abruf gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  let quelle: string;
  const s = jmapServer();
  const keinImap = async () => {
    throw new Error("kein IMAP");
  };
  const holen = () => abrufen(t, t.schluessel, quelle, keinImap, { abfragen: s.abfragen });

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    const res = await t.anfrage(
      "/api/quellen",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Stalwart",
          art: "jmap",
          host: "mail.example",
          port: 443,
          benutzer: "anna",
          passwort: "geheim",
        }),
      },
      cookie,
    );
    expect(res.status).toBe(201);
    quelle = (await res.json()).id;
  });
  afterAll(() => t?.aufraeumen());

  it("holt beim ersten Abruf den ganzen Ordner, ohne andere Ordner, und merkt sich den Stand", async () => {
    s.anlegen("m1", 1);
    s.anlegen("m2", 2);
    s.anlegen("x1", 99, "spam");
    expect(await holen()).toEqual({ neu: 2, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    const [q] = await t.sql`select jmap_stand, letzter_fehler from quellen where id = ${quelle}`;
    expect(q).toEqual({ jmap_stand: "4", letzter_fehler: null });
    const [e] = await t.sql`select actor from audit_log where table_name = 'dokumente' order by seq desc limit 1`;
    expect(e!.actor).toBe("system:jmap:Stalwart");
  });

  it("holt danach nur, was neu ist oder in den Ordner verschoben wurde", async () => {
    s.zustand.aufrufe = [];
    s.anlegen("m3", 3);
    s.verschieben("x1", "posteingang");
    s.anlegen("x2", 98, "spam");
    expect(await holen()).toEqual({ neu: 2, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    expect(s.zustand.aufrufe).toContain("Email/changes");
    expect(s.zustand.aufrufe).not.toContain("Email/query");
    expect(await holen()).toEqual({ neu: 0, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
  });

  it("holt den Ordner neu, wenn der Server die Änderungen nicht mehr kennt; doppelte zählen nur", async () => {
    s.zustand.keineAenderungen = true;
    expect(await holen()).toEqual({ neu: 0, doppelt: 4, anhaengeVorhanden: 0, fehler: null });
    s.zustand.keineAenderungen = false;
  });

  it("hält einen Fehler fest, etwa ein falsches Passwort", async () => {
    await t.sql`update quellen set ciphertext = ${(await import("../crypto.ts")).verschluesseln(t.schluessel, Buffer.from("falsch"))} where id = ${quelle}`;
    expect(await holen()).toEqual({ neu: 0, doppelt: 0, anhaengeVorhanden: 0, fehler: "JMAP: Antwort 401" });
    const [q] = await t.sql`select letzter_fehler from quellen where id = ${quelle}`;
    expect(q!.letzter_fehler).toBe("JMAP: Antwort 401");
  });
});

describe("JMAP-Abruf ohne Datenbank", () => {
  const zugang = {
    host: "mail.example",
    port: 443,
    tls: true,
    benutzer: "anna",
    passwort: "geheim",
    ordner: "INBOX",
  };
  const sammeln = () => {
    const mails: string[] = [];
    return { mails, aufnehmen: async (roh: Uint8Array) => void mails.push(new TextDecoder().decode(roh)) };
  };

  it("schickt die Zugangsdaten nicht an einen fremden Host aus der Sitzung (apiUrl)", async () => {
    const s = jmapServer({ sitzung: { apiUrl: "https://fremd.example/jmap/api" } });
    s.anlegen("m1", 1);
    await expect(jmapHolen(zugang, null, sammeln().aufnehmen, s.abfragen)).rejects.toThrow(/fremd/);
    expect(s.zustand.mitZugang.filter((u) => new URL(u).host !== "mail.example")).toEqual([]);
  });

  it("schickt die Zugangsdaten nicht an einen fremden Host aus der Sitzung (downloadUrl)", async () => {
    const s = jmapServer({
      sitzung: { downloadUrl: "https://fremd.example/jmap/download/{accountId}/{blobId}/{name}?type={type}" },
    });
    s.anlegen("m1", 1);
    await expect(jmapHolen(zugang, null, sammeln().aufnehmen, s.abfragen)).rejects.toThrow(/fremd/);
    expect(s.zustand.mitZugang.filter((u) => new URL(u).host !== "mail.example")).toEqual([]);
  });

  it("holt alle Mails, auch wenn der Server kleinere Seiten liefert als erbeten", async () => {
    const s = jmapServer({ hoechstens: 30 });
    for (let n = 1; n <= 70; n++) s.anlegen(`m${n}`, n);
    const { mails, aufnehmen } = sammeln();
    await jmapHolen(zugang, null, aufnehmen, s.abfragen);
    expect(mails).toHaveLength(70);
  });

  it("rückt den Stand nicht vor, wenn Email/get einen Fehler meldet, und holt die Mail beim nächsten Mal", async () => {
    const s = jmapServer();
    s.anlegen("m1", 1);
    const stand = await jmapHolen(zugang, null, sammeln().aufnehmen, s.abfragen);
    s.anlegen("m2", 2);
    s.zustand.getFehler = true;
    await expect(jmapHolen(zugang, stand, sammeln().aufnehmen, s.abfragen)).rejects.toThrow(/requestTooLarge/);
    const { mails, aufnehmen } = sammeln();
    await jmapHolen(zugang, stand, aufnehmen, s.abfragen);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain("JMAP 2");
  });
});
