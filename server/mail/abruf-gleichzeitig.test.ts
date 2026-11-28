import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { abrufen, anlegen, type Oeffnen } from "./abruf.ts";
import * as sperre from "./abruf-sperre.ts";
import { DATENBANK_MELDUNG } from "./pruefen.ts";

const { TAKT_MS } = sperre;
// Lässt den Herzschlag mit dem Fehler scheitern, den Drizzle bei einem Datenbankfehler wirft (Anweisung samt Parametern)
const kaputt = vi.hoisted(() => ({ an: false }));
vi.mock("./abruf-sperre.ts", async (original) => {
  const echt = await original<typeof import("./abruf-sperre.ts")>();
  return {
    ...echt,
    herzschlag: (...a: Parameters<typeof echt.herzschlag>) =>
      kaputt.an
        ? Promise.reject(new Error(`Failed query: update "abruf_sperren" set "seit" = now() params: ${a[1]},${a[2]}`))
        : echt.herzschlag(...a),
  };
});

const roh = (n: number, von: string) =>
  new TextEncoder().encode(
    `From: a@example.org\r\nTo: b@example.org\r\nSubject: Mail ${von} ${n}\r\nMessage-ID: <m${von}-${n}@example.org>\r\nDate: Mon, 1 Jan 2024 10:00:00 +0000\r\n\r\nText ${n}\r\n`,
  );

describe.skipIf(!testDatenbankUrl)("Abruf: höchstens einer je Postfach", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  // Ein Postfach mit 5 Mails; Öffnen dauert wie über das Netz ein wenig
  let oeffnenFehler = false;
  let dbFehler = false;
  // Tore: Das n-te Öffnen wartet, bis sein Tor aufgeht
  const tore: Promise<void>[] = [];
  let gleichzeitig = 0;
  let hoechstens = 0;
  const oeffnen: Oeffnen = async (zugang) => {
    if (oeffnenFehler) throw new Error("kaputt");
    if (dbFehler)
      throw new Error(
        'Failed query: update "quellen" set "letzte_uid" = $1 where "id" = $2 params: 5,geheimes-token,host.example,anna@example.org',
      );
    hoechstens = Math.max(hoechstens, ++gleichzeitig);
    try {
      await (tore.shift() ?? new Promise((r) => setTimeout(r, 100)));
    } finally {
      gleichzeitig--;
    }
    return {
      uidValidity: 1,
      async *neue(seit) {
        for (let uid = 1; uid <= 5; uid++) if (uid > seit) yield { uid, roh: roh(uid, zugang.benutzer) };
      },
      async schliessen() {},
    };
  };
  beforeAll(async () => {
    t = await testApp({ oeffnen });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("nimmt jede Mail nur einmal auf und meldet dem Klick, dass schon ein Abruf läuft", async () => {
    const res = await t.anfrage(
      "/api/quellen",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "r@",
          host: "imap.example.org",
          benutzer: "r@example.org",
          passwort: "geheim-123",
        }),
      },
      cookie,
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    // Der Inhaber klickt „Jetzt abrufen“, während der erste Abruf nach dem Anlegen noch läuft
    const klick = await (await t.anfrage(`/api/quellen/${id}/abrufen`, { method: "POST" }, cookie)).json();
    await t.abrufeAbwarten(id);
    const [zeile] = await t.sql`select count(*)::int as n from dokumente where mime_type = 'message/rfc822'`;
    expect(zeile?.n).toBe(5);
    expect(klick).toMatchObject({ laeuft: true, neu: 0, fehler: null });
  });

  let nummer = 0;
  // Ohne ersten Abruf: das Postfach hat 5 ungeholte Mails
  const frischeQuelle = async () => {
    const n = ++nummer;
    const q = await anlegen(
      t.db,
      t.schluessel,
      {
        name: `f${n}`,
        host: "imap.example.org",
        port: 993,
        tls: true,
        benutzer: `f${n}@example.org`,
        passwort: "geheim-123",
        ordner: "INBOX",
        art: "imap",
      },
      "test",
    );
    return q.id;
  };
  const umgebung = () => ({ db: t.db, speicher: t.speicher });
  const abruf = (id: string) => abrufen(umgebung(), t.schluessel, id, oeffnen);
  const dokumente = async () =>
    (await t.sql`select count(*)::int as n from dokumente where mime_type = 'message/rfc822'`)[0]!.n as number;
  const tor = () => {
    let auf!: () => void;
    tore.push(new Promise<void>((r) => (auf = r)));
    return auf;
  };
  const ablaufen = (id: string) =>
    t.sql`update abruf_sperren set seit = now() - interval '11 minutes' where quelle_id = ${id}`;

  it("lässt nie zwei Abrufe zugleich öffnen und meldet den übrigen, dass einer läuft", async () => {
    const id = await frischeQuelle();
    hoechstens = 0;
    const auf = tor();
    const erster = abruf(id);
    await vi.waitFor(() => expect(gleichzeitig).toBe(1));
    // Der erste hängt im Öffnen, bis alle übrigen zurück sind
    const uebrige = await Promise.all(Array.from({ length: 14 }, () => abruf(id)));
    auf();
    expect(uebrige.every((e) => e.laeuft)).toBe(true);
    expect(await erster).toMatchObject({ neu: 5, fehler: null });
    expect(hoechstens).toBe(1);
  });

  it("hält keine Verbindung: Abrufe unbekannter Postfächer kehren zurück", async () => {
    const unbekannt = "00000000-0000-4000-8000-000000000000";
    const ergebnisse = await Promise.allSettled(Array.from({ length: 15 }, () => abruf(unbekannt)));
    expect(ergebnisse.every((e) => e.status === "rejected")).toBe(true);
  });

  it("gibt die Sperre nach einem Fehler beim Öffnen frei, und der nächste Abruf läuft normal", async () => {
    const id = await frischeQuelle();
    oeffnenFehler = true;
    expect((await abruf(id)).fehler).not.toBeNull();
    oeffnenFehler = false;
    const danach = await abruf(id);
    expect(danach).toMatchObject({ neu: 5, fehler: null });
    expect(danach).not.toHaveProperty("laeuft");
  });

  it("übernimmt eine abgelaufene Sperre; der alte Lauf nimmt nichts mehr auf und gibt Bs Sperre nicht frei", async () => {
    const id = await frischeQuelle();
    const vorher = await dokumente();
    const aufA = tor();
    const a = abruf(id);
    await vi.waitFor(async () =>
      expect((await t.sql`select 1 from abruf_sperren where quelle_id = ${id}`).length).toBe(1),
    );
    await vi.waitFor(() => expect(gleichzeitig).toBe(1));
    expect(await abruf(id)).toMatchObject({ laeuft: true });
    await ablaufen(id);
    const aufB = tor();
    const b = abruf(id);
    await vi.waitFor(() => expect(gleichzeitig).toBe(2));
    aufA();
    const ergebnisA = await a;
    expect(ergebnisA.fehler).not.toBeNull();
    expect(await dokumente()).toBe(vorher);
    // Der verdrängte Lauf lässt den Stand der Quelle, wie er ist, solange B läuft
    expect(
      (
        await t.sql`select letzter_fehler, letzter_abruf, letzte_uid::int as letzte_uid from quellen where id = ${id}`
      )[0],
    ).toEqual({
      letzter_fehler: null,
      letzter_abruf: null,
      letzte_uid: 0,
    });
    // B hält weiter: C bekommt laeuft
    expect(await abruf(id)).toMatchObject({ laeuft: true });
    aufB();
    expect(await b).toMatchObject({ neu: 5, fehler: null });
    expect(await dokumente()).toBe(vorher + 5);
    expect((await t.sql`select 1 from abruf_sperren where quelle_id = ${id}`).length).toBe(0);
  });

  it("setzt den Herzschlag alle TAKT_MS, auch solange der Server nicht antwortet", async () => {
    const id = await frischeQuelle();
    const takte: (() => void)[] = [];
    const echt = globalThis.setInterval;
    const spion = vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === TAKT_MS) takte.push(fn);
      return ms === TAKT_MS ? echt(() => {}, 1_000_000) : echt(fn, ms);
    }) as typeof setInterval);
    const auf = tor();
    const lauf = abruf(id);
    await vi.waitFor(() => expect(takte.length).toBe(1));
    spion.mockRestore();
    await t.sql`update abruf_sperren set seit = now() - interval '5 minutes' where quelle_id = ${id}`;
    takte[0]!();
    await vi.waitFor(async () =>
      expect(
        (await t.sql`select 1 from abruf_sperren where quelle_id = ${id} and seit > now() - interval '1 minute'`)
          .length,
      ).toBe(1),
    );
    auf();
    await lauf;
  });

  it("schreibt bei einem Datenbankfehler im Herzschlag nur einen festen Satz ins Ergebnis und ins Audit-Log", async () => {
    const id = await frischeQuelle();
    kaputt.an = true;
    const ergebnis = await abruf(id).finally(() => (kaputt.an = false));
    expect(ergebnis.fehler).toBe("Die Sperre des Abrufs ließ sich nicht prüfen");
    const [q] = await t.sql`select letzter_fehler from quellen where id = ${id}`;
    expect(q!.letzter_fehler).toBe(ergebnis.fehler);
    const audit =
      await t.sql`select count(*)::int as n from audit_log where position('Failed query' in row_to_json(audit_log)::text) > 0`;
    expect(audit[0]!.n).toBe(0);
  });

  it("meldet einen Datenbankfehler im Abruf nur als festen Satz, ohne Anweisung und Parameter", async () => {
    const id = await frischeQuelle();
    dbFehler = true;
    const ergebnis = await abruf(id).finally(() => (dbFehler = false));
    expect(ergebnis.fehler).toBe(DATENBANK_MELDUNG);
    const [q] = await t.sql`select letzter_fehler from quellen where id = ${id}`;
    expect(q!.letzter_fehler).toBe(ergebnis.fehler);
    const audit =
      await t.sql`select count(*)::int as n from audit_log where position('Failed query' in row_to_json(audit_log)::text) > 0 or position('geheimes-token' in row_to_json(audit_log)::text) > 0`;
    expect(audit[0]!.n).toBe(0);
  });
});
