import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entschluesseln } from "../crypto.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import type { Oeffnen, Zugang } from "./abruf.ts";
import { GRUND_MELDUNG } from "./pruefen.ts";

const roh = (n: number) =>
  new TextEncoder().encode(
    [
      "From: kunde@kunde.de",
      "To: anna@example.org",
      `Subject: Nachricht ${n}`,
      `Message-ID: <n-${n}@kunde.de>`,
      "",
      `Text ${n}`,
    ].join("\r\n"),
  );

/** Nachgebautes Postfach: Nachrichten mit UID, UIDVALIDITY und optional ein Fehler beim Öffnen */
function postfach() {
  const zustand = {
    uidValidity: 1,
    nachrichten: new Map<number, Uint8Array>(),
    fehler: null as string | null,
    fehlerAntwort: null as string | null,
    fehlerMerkmale: {} as Record<string, unknown>,
    zuletzt: null as Zugang | null,
  };
  const oeffnen: Oeffnen = async (zugang) => {
    zustand.zuletzt = zugang;
    if (zustand.fehler)
      throw Object.assign(new Error(zustand.fehler), {
        responseText: zustand.fehlerAntwort,
        ...zustand.fehlerMerkmale,
      });
    return {
      uidValidity: zustand.uidValidity,
      async *neue(seit) {
        for (const [uid, r] of [...zustand.nachrichten].sort(([a], [b]) => a - b))
          if (uid > seit) yield { uid, roh: r };
      },
      async schliessen() {},
    };
  };
  return { zustand, oeffnen };
}

describe.skipIf(!testDatenbankUrl)("IMAP-Abruf gegen Postgres", () => {
  const p = postfach();
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  let quelle: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const abrufen = async () => (await anfrage(`/api/quellen/${quelle}/abrufen`, { method: "POST" })).json();

  beforeAll(async () => {
    t = await testApp({ oeffnen: p.oeffnen });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("legt eine Quelle an und speichert das Passwort nur verschlüsselt", async () => {
    const res = await anfrage("/api/quellen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "rechnung@",
        host: "imap.example.org",
        benutzer: "rechnung@example.org",
        passwort: "geheim-123",
      }),
    });
    expect(res.status).toBe(201);
    const q = await res.json();
    quelle = q.id;
    await t.abrufeAbwarten(quelle);
    expect(q).not.toHaveProperty("ciphertext");
    expect(JSON.stringify(await (await anfrage("/api/quellen")).json())).not.toContain("geheim-123");
    const [zeile] = await t.sql`select ciphertext from quellen where id = ${quelle}`;
    expect(Buffer.from(zeile!.ciphertext).includes(Buffer.from("geheim-123"))).toBe(false);
    expect(entschluesseln(t.schluessel, zeile!.ciphertext).toString()).toBe("geheim-123");
    expect(JSON.stringify(await t.sql`select new_value from audit_log where table_name = 'quellen'`)).not.toContain(
      "ciphertext",
    );
  });

  it("holt neue Mails, merkt sich die letzte UID und holt beim nächsten Mal nur Neueres", async () => {
    p.zustand.nachrichten.set(1, roh(1));
    p.zustand.nachrichten.set(2, roh(2));
    expect(await abrufen()).toEqual({ neu: 2, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    expect(p.zustand.zuletzt).toMatchObject({
      host: "imap.example.org",
      benutzer: "rechnung@example.org",
      passwort: "geheim-123",
      ordner: "INBOX",
    });
    p.zustand.nachrichten.set(5, roh(5));
    expect(await abrufen()).toEqual({ neu: 1, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    const [q] = await t.sql`select letzte_uid, letzter_fehler from quellen where id = ${quelle}`;
    expect(q).toEqual({ letzte_uid: "5", letzter_fehler: null });
    const [eintrag] = await t.sql`select actor from audit_log where table_name = 'dokumente' order by seq desc limit 1`;
    expect(eintrag!.actor).toBe("system:imap:rechnung@");
  });

  it("beginnt bei neuer UIDVALIDITY von vorn, ohne Mails doppelt aufzunehmen", async () => {
    p.zustand.uidValidity = 2;
    p.zustand.nachrichten = new Map([
      [1, roh(1)],
      [2, roh(2)],
      [3, roh(5)],
      [4, roh(6)],
    ]);
    expect(await abrufen()).toEqual({ neu: 1, doppelt: 3, anhaengeVorhanden: 0, fehler: null });
  });

  it("notiert einen Fehler, ohne Zugangsdaten preiszugeben", async () => {
    p.zustand.fehler = "Anmeldung abgelehnt";
    expect(await abrufen()).toEqual({ neu: 0, doppelt: 0, anhaengeVorhanden: 0, fehler: "Anmeldung abgelehnt" });
    const [q] = await t.sql`select letzter_fehler from quellen where id = ${quelle}`;
    expect(q!.letzter_fehler).toBe("Anmeldung abgelehnt");
    p.zustand.fehler = null;
  });

  it("schreibt nie die Rohantwort des Servers in letzter_fehler und das Audit-Log, auch nicht mit Passwort in jeder Form", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const passwort = "geheim-123";
    const formen = [
      'LOGIN "rechnung@example.org" "geheim-123" abgelehnt',
      `AUTHENTICATE PLAIN ${b64("\0rechnung@example.org\0geheim-123")}`,
      `Basic ${b64("rechnung@example.org:geheim-123")}`,
      b64(`n,a=rechnung@example.org,\x01auth=Bearer ${passwort}\x01\x01`),
      Buffer.from("pässwört€x").toString("latin1"),
      "Ungültige Zugangsdaten",
    ];
    for (const merkmale of [{ authenticationFailed: true }, {}]) {
      for (const antwort of formen) {
        p.zustand.fehler = "Command failed";
        p.zustand.fehlerAntwort = antwort;
        p.zustand.fehlerMerkmale = merkmale;
        const { fehler } = await abrufen();
        // Erkannter Grund: fester Satz; sonst nur message, nie responseText
        const erwartet = "authenticationFailed" in merkmale ? GRUND_MELDUNG.anmeldung : "Command failed";
        expect(fehler).toBe(erwartet);
        const [q] = await t.sql`select letzter_fehler from quellen where id = ${quelle}`;
        expect(q!.letzter_fehler).toBe(erwartet);
      }
    }
    // Der Audit-Trigger kopiert letzter_fehler in das append-only Log
    const audit = JSON.stringify(await t.sql`select old_value, new_value from audit_log where table_name = 'quellen'`);
    expect(audit).toContain(GRUND_MELDUNG.anmeldung);
    for (const f of [passwort, ...formen.slice(1, 5)]) expect(audit).not.toContain(f);
    p.zustand.fehler = null;
    p.zustand.fehlerAntwort = null;
    p.zustand.fehlerMerkmale = {};
  });

  it("lehnt ungültige Quellen ab und lässt Quellen aus- und einschalten", async () => {
    expect(
      (
        await anfrage("/api/quellen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x", host: "h", benutzer: "u" }),
        })
      ).status,
    ).toBe(400);
    expect((await (await anfrage(`/api/quellen/${quelle}/deaktivieren`, { method: "POST" })).json()).aktiv).toBe(false);
  });

  it("hat nach allem eine intakte Kette", async () => {
    expect(await (await anfrage("/api/pruefung")).json()).toMatchObject({ ok: true, befunde: [] });
  });
});
