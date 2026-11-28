import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import type { Oeffnen, Postfach } from "./abruf.ts";
import {
  abrufFehler,
  bereinigen,
  fehlerGrund,
  GEHEIMNIS_MELDUNG,
  GRUND_MELDUNG,
  verbindungPruefen,
} from "./pruefen.ts";
import { mailRoh, testPostfaecher } from "./test-postfach.ts";

const PASSWORT = "geheim-im-test";

/* Die Formen entsprechen den Fehlern von imapflow (dist/esm/commands/login.js, tools.js) und Node */
const imapFehler = (props: Record<string, unknown>) => Object.assign(new Error("Command failed"), props);

describe("Fehler einem Grund zuordnen", () => {
  it.each([
    [
      "Anmeldung abgelehnt",
      imapFehler({ authenticationFailed: true, serverResponseCode: "AUTHENTICATIONFAILED" }),
      "anmeldung",
    ],
    [
      "Anmeldung ohne Code",
      imapFehler({ authenticationFailed: true, responseText: "Invalid credentials" }),
      "anmeldung",
    ],
    [
      "Ordner (Dovecot)",
      imapFehler({ serverResponseCode: "NONEXISTENT", responseText: "Mailbox doesn't exist: X" }),
      "ordner",
    ],
    ["Ordner (Gmail)", imapFehler({ responseStatus: "NO", responseText: "Unknown Mailbox: X (Failure)" }), "ordner"],
    ["Name unbekannt", Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" }), "server"],
    ["Verbindung abgelehnt", Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), "server"],
    ["Verbindung weg", Object.assign(new Error("Connection not available"), { code: "NoConnection" }), "server"],
    [
      "Zertifikat",
      Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
      "server",
    ],
    [
      "Name im Zertifikat",
      Object.assign(new Error("Hostname/IP does not match"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
      "server",
    ],
    ["Socket-Zeit", Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }), "zeit"],
    ["imapflow-Zeit", Object.assign(new Error("Connection timed out"), { code: "CONNECT_TIMEOUT" }), "zeit"],
    ["AbortSignal-Zeit", new DOMException("The operation timed out.", "TimeoutError"), "zeit"],
    ["fetch ohne Server", Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), "server"],
    ["JMAP Anmeldung", new Error("JMAP: Antwort 401"), "anmeldung"],
    ["JMAP Serverfehler", new Error("JMAP: Antwort 502"), "server"],
    ["JMAP Ordner", new Error("JMAP: Ordner X nicht gefunden"), "ordner"],
    ["etwas anderes", new Error("boom"), "unbekannt"],
    ["kein Fehlerobjekt", "text", "unbekannt"],
  ])("%s", (_, err, grund) => {
    expect(fehlerGrund(err)).toBe(grund);
  });

  it("nimmt den Text der Antwort statt „Command failed“ und kürzt auf 500 Zeichen", () => {
    expect(bereinigen(imapFehler({ responseText: "Login failed" }), [PASSWORT])).toBe("Login failed");
    expect(bereinigen(new Error("x".repeat(900)), [PASSWORT])).toHaveLength(500);
    expect(bereinigen(new Error(`Kennwort ${PASSWORT} falsch`), [""])).toBe(`Kennwort ${PASSWORT} falsch`);
  });

  it("wirft nicht bei einem Geheimnis mit einzelnem Ersatzzeichen", () => {
    expect(bereinigen(new Error("Login abgelehnt"), ["ab\uD800cd"])).toBe("Login abgelehnt");
    // So kommt es beim Server an (UTF-8 mit U+FFFD) und so käme es zurück
    expect(bereinigen(new Error('LOGIN "u" "ab�cd"'), ["ab\uD800cd"])).toBe(GEHEIMNIS_MELDUNG);
  });

  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const SCHWER = 'pa"ss\\wort';
  it.each([
    ["roh", PASSWORT, `Kennwort ${PASSWORT} falsch`],
    ["IMAP-quoted (imapflow)", SCHWER, '2 LOGIN "u" "pa\\"ss\\\\wort"'],
    ["Base64 des Passworts", PASSWORT, `AUTH ${b64(PASSWORT)}`],
    ["Base64 von PLAIN", PASSWORT, `AUTHENTICATE PLAIN ${b64(`\0u\0${PASSWORT}`)}`],
    ["Base64 von Basic", SCHWER, `Authorization: Basic ${b64(`u:${SCHWER}`)}`],
    ["Base64 ohne Auffüllung", PASSWORT, `x ${b64(`u:${PASSWORT}`).replace(/=+$/, "")} y`],
    ["URL-kodiert", SCHWER, `?pw=${encodeURIComponent(SCHWER)}`],
  ])("ersetzt den ganzen Text durch den festen Satz: %s", (_, passwort, text) => {
    expect(bereinigen(imapFehler({ responseText: text }), [passwort])).toBe(GEHEIMNIS_MELDUNG);
  });

  it("ersetzt bei einem kurzen Passwort den ganzen Text, statt Teile zu schwärzen", () => {
    const r = bereinigen(imapFehler({ responseText: "Invalid credentials for mail.example" }), ["a"]);
    expect(r).toBe(GEHEIMNIS_MELDUNG);
  });

  it("erkennt ein Access-Token roh, als Base64 und in XOAUTH2- und OAUTHBEARER-Zeilen mit jeder Benutzerlänge", () => {
    const token = "ya29.zugriffs-token";
    const zeilen = ["u", "ab", "abc", "rechnung@gmail.com"].flatMap((u) => [
      b64(`user=${u}\x01auth=Bearer ${token}\x01\x01`),
      b64(`n,a=${u},\x01host=imap.gmail.com\x01port=993\x01auth=Bearer ${token}\x01\x01`),
    ]);
    for (const text of [`bad ${token}`, b64(token), ...zeilen])
      expect(bereinigen(imapFehler({ responseText: text }), ["", token])).toBe(GEHEIMNIS_MELDUNG);
  });

  it("erkennt ein als latin1 gelesenes Passwort, roh und IMAP-quoted, und ändert Groß-/Kleinschreibung nicht zum Schlupfloch", () => {
    const passwort = 'pä"ssw€rt';
    const latin1 = Buffer.from(passwort).toString("latin1");
    for (const text of [latin1, latin1.replace(/"/g, '\\"'), PASSWORT.toUpperCase()])
      expect(bereinigen(imapFehler({ responseText: text }), [passwort, PASSWORT])).toBe(GEHEIMNIS_MELDUNG);
  });

  it("lässt einen Text ohne Geheimnis durch, auch mit Base64-Zeichen", () => {
    expect(bereinigen(imapFehler({ responseText: b64("etwas anderes") }), [PASSWORT])).toBe(b64("etwas anderes"));
  });
});

describe("Text am Postfach nach einem Abruf", () => {
  it("nennt bei erkanntem Grund nur den festen Satz, nie die Rohantwort", () => {
    const err = imapFehler({ authenticationFailed: true, responseText: `Login ${PASSWORT} abgelehnt` });
    expect(abrufFehler(err, [PASSWORT])).toBe(GRUND_MELDUNG.anmeldung);
  });

  it("nimmt sonst nur message, nie responseText, und entfernt Geheimnisse daraus", () => {
    expect(abrufFehler(imapFehler({ responseText: `roh ${PASSWORT}` }), [PASSWORT])).toBe("Command failed");
    expect(abrufFehler(new Error(`Kennwort ${PASSWORT}`), [PASSWORT])).toBe(GEHEIMNIS_MELDUNG);
    expect(abrufFehler(new Error("boom"), [PASSWORT])).toBe("boom");
  });
});

describe("JMAP-Prüfung mit Frist", () => {
  it("bricht nach zeitMs mit Grund zeit ab und bricht den Abruf selbst ab", async () => {
    let signal: AbortSignal | undefined;
    const abfragen = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, nein) => {
        signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => nein(signal!.reason));
      });
    const r = await verbindungPruefen(
      {
        name: "x",
        host: "jmap.example.org",
        port: 443,
        tls: true,
        benutzer: "u",
        passwort: PASSWORT,
        ordner: "INBOX",
        art: "jmap",
      },
      async () => {
        throw new Error("nicht benutzt");
      },
      { abfragen, zeitMs: 300 },
    );
    expect(r).toMatchObject({ ok: false, grund: "zeit" });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});

/* POST /api/quellen prüft die Verbindung vor dem Speichern, gegen Postgres */
describe.skipIf(!testDatenbankUrl)("Postfach anlegen mit Prüfung", () => {
  const p = testPostfaecher();
  let oeffnen: Oeffnen = p.oeffnen;
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  let jmapAntwort: (url: string, init: RequestInit) => Promise<Response> = async () =>
    new Response(null, { status: 500 });
  const eingabe = (zusatz: Record<string, unknown> = {}) => ({
    name: "Rechnungen",
    host: "imap.example.org",
    benutzer: "rechnung@example.org",
    passwort: PASSWORT,
    ...zusatz,
  });
  const anlegen = (body: unknown) =>
    t.anfrage(
      "/api/quellen",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );
  const zaehler = async () => ({
    quellen: (await t.sql`select count(*)::int as n from quellen`)[0]!.n as number,
    audit: (await t.sql`select count(*)::int as n from audit_log where table_name = 'quellen'`)[0]!.n as number,
  });
  const abgelehnt = async (body: unknown) => {
    const vorher = await zaehler();
    const res = await anlegen(body);
    expect(res.status).toBe(422);
    // Nichts gespeichert, auch kein Audit-Eintrag
    expect(await zaehler()).toEqual(vorher);
    return {
      text: await res.clone().text(),
      antwort: (await res.json()) as { fehler: string; grund: string; details: string },
    };
  };

  beforeAll(async () => {
    t = await testApp({
      oeffnen: (z) => oeffnen(z),
      pruefZeitMs: 300,
      abfragen: (url, init) => jmapAntwort(url, init),
    });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("lehnt falsche Zugangsdaten mit 422 und Grund anmeldung ab und speichert nichts", async () => {
    oeffnen = async () => {
      throw imapFehler({
        authenticationFailed: true,
        serverResponseCode: "AUTHENTICATIONFAILED",
        responseText: "Invalid credentials",
      });
    };
    const { antwort } = await abgelehnt(eingabe());
    expect(antwort).toEqual({
      fehler: "Die Anmeldung beim Postfach ist fehlgeschlagen",
      grund: "anmeldung",
      details: "Invalid credentials",
    });
  });

  it("nennt einen fehlenden Ordner, einen nicht erreichbaren Server und eine Zeitüberschreitung als eigenen Grund", async () => {
    oeffnen = async () => {
      throw imapFehler({ serverResponseCode: "NONEXISTENT", responseText: "Mailbox doesn't exist: Gibtsnicht" });
    };
    expect((await abgelehnt(eingabe({ ordner: "Gibtsnicht" }))).antwort.grund).toBe("ordner");

    oeffnen = async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" });
    };
    expect((await abgelehnt(eingabe())).antwort.grund).toBe("server");

    // Der Server antwortet nie; die Verbindung, die doch noch aufgeht, wird geschlossen
    const schliessen = vi.fn(async () => {});
    const spaet: Postfach = { uidValidity: 1, async *neue() {}, schliessen };
    oeffnen = () => new Promise((ok) => setTimeout(() => ok(spaet), 600));
    expect((await abgelehnt(eingabe())).antwort.grund).toBe("zeit");
    await vi.waitFor(() => expect(schliessen).toHaveBeenCalled());
  });

  it("zeigt das Passwort weder in der Antwort noch in details, auch wenn der Server es zurückgibt", async () => {
    oeffnen = async () => {
      throw imapFehler({
        authenticationFailed: true,
        responseText: `Login ${PASSWORT} abgelehnt für rechnung@example.org`,
      });
    };
    const { text, antwort } = await abgelehnt(eingabe());
    expect(antwort.details).toBe(GEHEIMNIS_MELDUNG);
    expect(text).not.toContain(PASSWORT);
  });

  it("meldet ein nicht erreichbares Postfach (502) nur mit festem Satz, nie mit dem Text des Servers", async () => {
    oeffnen = p.oeffnen;
    const res = await anlegen(eingabe({ name: "Ordnerliste", benutzer: "ordnerliste@example.org" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    oeffnen = async () => {
      throw imapFehler({ responseText: `Login ${PASSWORT} abgelehnt` });
    };
    const antwort = await t.anfrage(`/api/quellen/${id}/ordner`, {}, cookie);
    expect(antwort.status).toBe(502);
    const text = await antwort.text();
    expect(text).not.toContain(PASSWORT);
    expect(JSON.parse(text)).toEqual({ fehler: GRUND_MELDUNG.unbekannt });
  });

  it("legt bei Erfolg an (201) und ruft die Mails des Postfachs von selbst ab", async () => {
    oeffnen = p.oeffnen;
    p.einliefern("rechnung@example.org", mailRoh(1));
    p.einliefern("rechnung@example.org", mailRoh(2));
    const res = await anlegen(eingabe());
    expect(res.status).toBe(201);
    const q = (await res.json()) as { id: string };
    await vi.waitFor(async () => {
      const [z] = await t.sql`select letzter_abruf, letzter_fehler, letzte_uid::int from quellen where id = ${q.id}`;
      expect(z!.letzter_abruf).not.toBeNull();
      expect(z).toMatchObject({ letzter_fehler: null, letzte_uid: 2 });
    });
    const [d] = await t.sql`select count(*)::int as n from dokumente where quelle = 'mail'`;
    expect(d!.n).toBe(2);
  });

  it("prüft JMAP: Sitzung und Ordnerliste, und der Ordner muss dabei sein", async () => {
    const richtig = `Basic ${Buffer.from(`jmap@example.org:${PASSWORT}`).toString("base64")}`;
    jmapAntwort = async (url, init) => {
      if ((init.headers as Record<string, string>).authorization !== richtig)
        return new Response(null, { status: 401 });
      const json = (daten: unknown) => Response.json(daten);
      if (new URL(url).pathname === "/.well-known/jmap")
        return json({
          apiUrl: "/jmap/api",
          downloadUrl: "/d/{blobId}",
          primaryAccounts: { "urn:ietf:params:jmap:mail": "k1" },
        });
      const { methodCalls } = JSON.parse(String(init.body)) as { methodCalls: [string, unknown, string][] };
      const antwort = (name: string) =>
        name === "Mailbox/get"
          ? { list: [{ id: "m1", name: "Posteingang", role: "inbox" }] }
          : name === "Email/get"
            ? { state: "1", list: [] }
            : { ids: [], total: 0 };
      return json({ methodResponses: methodCalls.map(([name, , id]) => [name, antwort(name), id]) });
    };
    const jmap = eingabe({ art: "jmap", host: "jmap.example.org", benutzer: "jmap@example.org" });
    expect((await abgelehnt({ ...jmap, passwort: "falsch-im-test" })).antwort.grund).toBe("anmeldung");
    expect((await abgelehnt({ ...jmap, ordner: "Rechnungen" })).antwort.grund).toBe("ordner");
    const res = await anlegen({ ...jmap, ordner: "INBOX" });
    expect(res.status).toBe(201);
    const q = (await res.json()) as { id: string };
    await vi.waitFor(async () => {
      const [z] = await t.sql`select letzter_abruf, letzter_fehler from quellen where id = ${q.id}`;
      expect(z).toMatchObject({ letzter_fehler: null });
      expect(z!.letzter_abruf).not.toBeNull();
    });
  });
});
