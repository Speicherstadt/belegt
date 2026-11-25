import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entschluesseln } from "../crypto.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { abrufen, type Oeffnen } from "./abruf.ts";
import { aktionenAusfuehren } from "./aktionen-ausfuehren.ts";
import { mailRoh, testPostfaecher } from "./test-postfach.ts";

/* Postfächer ändern und entfernen (PATCH und DELETE /api/quellen/:id), gegen Postgres */
describe.skipIf(!testDatenbankUrl)("Postfächer ändern und entfernen", () => {
  const p = testPostfaecher();
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const unbekannt = "00000000-0000-4000-8000-000000000000";
  const senden = (methode: string, pfad: string, body?: unknown, cookie = inhaber) =>
    t.anfrage(
      pfad,
      body === undefined
        ? { method: methode }
        : { method: methode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );

  async function quelle(benutzer: string) {
    const res = await senden("POST", "/api/quellen", {
      name: benutzer,
      host: "imap.example.org",
      benutzer,
      passwort: "altes-passwort-1",
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }
  const zeile = async (id: string) =>
    (
      await t.sql<
        {
          name: string;
          host: string;
          ciphertext: Buffer;
          letzte_uid: number;
          uid_validity: number | null;
          jmap_stand: string | null;
          letzter_fehler: string | null;
        }[]
      >`select name, host, ciphertext, letzte_uid::int, uid_validity::int, jmap_stand, letzter_fehler
          from quellen where id = ${id}`
    )[0]!;

  beforeAll(async () => {
    t = await testApp({ oeffnen: p.oeffnen });
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("ändert ohne Passwort nur die Felder; das Chiffrat bleibt, Antwort und Audit ohne Geheimnis", async () => {
    const id = await quelle("ohne-passwort@example.org");
    const vorher = await zeile(id);
    const res = await senden("PATCH", `/api/quellen/${id}`, { name: "Neuer Name", ordner: "Rechnungen", tls: true });
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q).toMatchObject({
      id,
      name: "Neuer Name",
      ordner: "Rechnungen",
      tls: true,
      host: "imap.example.org",
      art: "imap",
    });
    expect(JSON.stringify(q)).not.toMatch(/ciphertext|altes-passwort/);
    const nachher = await zeile(id);
    expect(nachher.name).toBe("Neuer Name");
    expect(nachher.ciphertext.equals(vorher.ciphertext)).toBe(true);
    const [e] = await t.sql`select actor, old_value, new_value from audit_log
      where table_name = 'quellen' and action = 'UPDATE' and row_id = ${id} order by seq desc limit 1`;
    expect(e!.actor).toBe("nutzer:anna@example.org");
    expect(JSON.stringify(e)).not.toContain("ciphertext");
  });

  it("verschlüsselt ein neues Passwort neu und nennt es nirgends im Klartext", async () => {
    const id = await quelle("mit-passwort@example.org");
    const vorher = await zeile(id);
    expect(entschluesseln(t.schluessel, vorher.ciphertext).toString()).toBe("altes-passwort-1");
    const res = await senden("PATCH", `/api/quellen/${id}`, { passwort: "neues-passwort-2" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/neues-passwort-2|ciphertext/);
    const nachher = await zeile(id);
    expect(nachher.ciphertext.equals(vorher.ciphertext)).toBe(false);
    expect(entschluesseln(t.schluessel, nachher.ciphertext).toString()).toBe("neues-passwort-2");
    const audit =
      await t.sql`select old_value, new_value from audit_log where table_name = 'quellen' and row_id = ${id}`;
    expect(JSON.stringify(audit)).not.toMatch(/neues-passwort-2|altes-passwort-1|ciphertext/);
  });

  it("setzt den Abrufstand zurück, wenn Server, Port, Benutzer oder Ordner sich ändern, sonst nicht", async () => {
    const id = await quelle("stand@example.org");
    await t.sql`update quellen set letzte_uid = 7, uid_validity = 3, jmap_stand = 's1', letzter_fehler = 'kaputt'
                where id = ${id}`;
    // Nur der Name oder gleiche Werte lassen den Stand stehen
    expect(
      (await senden("PATCH", `/api/quellen/${id}`, { name: "x", host: "imap.example.org", port: 993 })).status,
    ).toBe(200);
    expect(await zeile(id)).toMatchObject({
      letzte_uid: 7,
      uid_validity: 3,
      jmap_stand: "s1",
      letzter_fehler: "kaputt",
    });
    // Server, Port und Benutzer nur mit neuem Passwort (siehe unten); der Ordner allein genügt
    for (const aenderung of [
      { host: "neu.example.org", passwort: "neues-passwort-3" },
      { port: 1993, passwort: "neues-passwort-3" },
      { benutzer: "anderer", passwort: "neues-passwort-3" },
      { ordner: "Rechnungen" },
    ]) {
      await t.sql`update quellen set letzte_uid = 7, uid_validity = 3, jmap_stand = 's1', letzter_fehler = 'kaputt'
                  where id = ${id}`;
      expect((await senden("PATCH", `/api/quellen/${id}`, aenderung)).status).toBe(200);
      expect(await zeile(id), JSON.stringify(aenderung)).toMatchObject({
        letzte_uid: 0,
        uid_validity: null,
        jmap_stand: null,
        letzter_fehler: null,
      });
    }
  });

  it("ändert Server, Port oder Benutzer eines Passwort-Postfachs nur mit neuem Passwort", async () => {
    const id = await quelle("fremd@example.org");
    const vorher = await zeile(id);
    for (const body of [{ host: "boese.example.org" }, { port: 1993 }, { benutzer: "anderer" }]) {
      const res = await senden("PATCH", `/api/quellen/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { fehler: string }).fehler).toMatch(/Passwort.*neu eingegeben/);
    }
    const nachher = await zeile(id);
    expect(nachher.host).toBe("imap.example.org");
    expect(nachher.ciphertext.equals(vorher.ciphertext)).toBe(true);
  });

  it("schaltet TLS bei einem Passwort-Postfach nur mit neuem Passwort ab, Einschalten geht ohne", async () => {
    for (const art of ["imap", "jmap"] as const) {
      const [q] = await t.sql<{ id: string }[]>`insert into quellen (name, host, benutzer, ciphertext, art)
        values (${`tls-${art}`}, 'imap.example.org', 'tls@example.org', ${Buffer.from("x")}, ${art}) returning id`;
      const id = q!.id;
      const res = await senden("PATCH", `/api/quellen/${id}`, { tls: false });
      expect(res.status, art).toBe(400);
      expect(((await res.json()) as { fehler: string }).fehler).toMatch(/Passwort.*neu eingegeben/);
      expect((await t.sql`select tls from quellen where id = ${id}`)[0]!.tls).toBe(true);
      expect((await senden("PATCH", `/api/quellen/${id}`, { tls: false, passwort: "neues-passwort-4" })).status).toBe(
        200,
      );
      expect((await senden("PATCH", `/api/quellen/${id}`, { tls: true })).status).toBe(200);
    }
  });

  it("lässt vorgemerkte Aktionen entfallen, wenn Server, Port oder Benutzer wechseln, und führt sie nicht aus", async () => {
    const benutzer = "wechsel@example.org";
    const id = await quelle(benutzer);
    expect((await senden("POST", `/api/quellen/${id}/aktion`, { aktion: "gelesen" })).status).toBe(200);
    p.einliefern(benutzer, mailRoh(1, "wechsel"));
    expect((await senden("POST", `/api/quellen/${id}/abrufen`)).status).toBe(200);
    const status = () => t.sql`select status from postfach_mails where quelle_id = ${id}`;
    expect(await status()).toEqual([{ status: "offen" }]);
    expect(
      (await senden("PATCH", `/api/quellen/${id}`, { benutzer: "anderer@example.org", passwort: "neues-passwort-5" }))
        .status,
    ).toBe(200);
    expect(await status()).toEqual([{ status: "entfallen" }]);
    const [pro] = await t.sql`select ergebnis, aktion from postfach_aktionen where quelle_id = ${id}`;
    expect(pro).toMatchObject({ ergebnis: "entfallen", aktion: "gelesen" });
    const ergebnis = await aktionenAusfuehren({ db: t.db, speicher: t.speicher }, t.schluessel, id, p.oeffnen);
    expect(ergebnis).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual([]);
    expect(p.konto("anderer@example.org").aufrufe).toEqual([]);
  });

  it("lässt den zurückgesetzten Abrufstand stehen, wenn das Postfach mitten im Abruf geändert wird", async () => {
    const benutzer = "rennen@example.org";
    const id = await quelle(benutzer);
    p.einliefern(benutzer, mailRoh(1, "rennen"));
    const mittendrin: Oeffnen = async (zugang) => {
      const postfach = await p.oeffnen(zugang);
      return {
        ...postfach,
        async *neue(seit) {
          for await (const n of postfach.neue(seit)) {
            // Wie ein PATCH, der Ordner ändert und den Stand zurücksetzt
            await t.sql`update quellen set ordner = 'Rechnungen', letzte_uid = 0, uid_validity = null where id = ${id}`;
            yield n;
          }
        },
      };
    };
    expect((await abrufen({ db: t.db, speicher: t.speicher }, t.schluessel, id, mittendrin)).neu).toBe(1);
    expect(await zeile(id)).toMatchObject({ letzte_uid: 0, uid_validity: null });
  });

  it("merkt nichts vor, wenn Server und Benutzer mitten im Abruf wechseln", async () => {
    const benutzer = "wechselt@example.org";
    const id = await quelle(benutzer);
    expect((await senden("POST", `/api/quellen/${id}/aktion`, { aktion: "gelesen" })).status).toBe(200);
    p.einliefern(benutzer, mailRoh(1, "wechselt"));
    const stand = () => t.sql`select letzter_abruf, letzter_fehler from quellen where id = ${id}`;
    const vorher = await stand();
    const mittendrin: Oeffnen = async (zugang) => {
      const postfach = await p.oeffnen(zugang);
      return {
        ...postfach,
        async *neue(seit) {
          for await (const n of postfach.neue(seit)) {
            // Wie ein PATCH mit neuem Server und Benutzer: Zeile gesperrt und geändert, erst nach dem Aufnehmen fertig
            await new Promise<void>((bereit) => {
              void t.sql.begin(async (tx) => {
                await tx`update quellen set host = 'anders.example.org', benutzer = 'anderer@example.org',
                  letzte_uid = 0, uid_validity = null where id = ${id}`;
                bereit();
                await new Promise((r) => setTimeout(r, 500));
              });
            });
            yield n;
          }
        },
      };
    };
    expect((await abrufen({ db: t.db, speicher: t.speicher }, t.schluessel, id, mittendrin)).neu).toBe(1);
    expect((await t.sql`select count(*)::int as n from postfach_mails where quelle_id = ${id}`)[0]!.n).toBe(0);
    expect(await stand()).toEqual(vorher);
  });

  it("antwortet 404 für unbekannte Nummern und 400 für ungültige Eingaben, art bleibt unveränderbar", async () => {
    const id = await quelle("ungueltig@example.org");
    expect((await senden("PATCH", `/api/quellen/${unbekannt}`, { name: "x" })).status).toBe(404);
    expect((await senden("PATCH", "/api/quellen/keine-id", { name: "x" })).status).toBe(404);
    for (const body of [
      {},
      { port: 0 },
      { port: 70000 },
      { host: " " },
      { passwort: "" },
      { tls: "ja" },
      { art: "jmap" },
    ])
      expect((await senden("PATCH", `/api/quellen/${id}`, body)).status, JSON.stringify(body)).toBe(400);
    expect(await zeile(id)).toMatchObject({ name: "ungueltig@example.org" });
  });

  it("ändert bei OAuth weder Passwort noch Server noch Benutzer, wohl aber Name und Ordner", async () => {
    const [q] = await t.sql<{ id: string }[]>`insert into quellen (name, host, benutzer, ciphertext, oauth)
      values ('oauth', 'imap.gmail.com', 'o@example.org', ${Buffer.from("refresh")}, 'google') returning id`;
    const id = q!.id;
    for (const body of [
      { passwort: "x" },
      { host: "anders.example.org" },
      { benutzer: "anderer@example.org" },
      { port: 143 },
      { tls: false },
    ])
      expect((await senden("PATCH", `/api/quellen/${id}`, body)).status, JSON.stringify(body)).toBe(400);
    expect(
      (
        await senden("PATCH", `/api/quellen/${id}`, {
          name: "Neu",
          ordner: "Rechnungen",
          host: "imap.gmail.com",
          port: 993,
          tls: true,
        })
      ).status,
    ).toBe(200);
    expect(await zeile(id)).toMatchObject({ name: "Neu", host: "imap.gmail.com" });
  });

  it("entfernt ein frisches Postfach mit 204, ohne Chiffrat im Audit-Log; danach 404", async () => {
    const id = await quelle("weg@example.org");
    expect((await senden("DELETE", `/api/quellen/${id}`)).status).toBe(204);
    expect(await t.sql`select 1 from quellen where id = ${id}`).toHaveLength(0);
    expect((await senden("DELETE", `/api/quellen/${id}`)).status).toBe(404);
    expect((await senden("DELETE", "/api/quellen/keine-id")).status).toBe(404);
    const [e] = await t.sql`select actor, old_value from audit_log
      where table_name = 'quellen' and action = 'DELETE' and row_id = ${id}`;
    expect(e!.actor).toBe("nutzer:anna@example.org");
    expect(JSON.stringify(e)).not.toContain("ciphertext");
  });

  it("entfernt ein Postfach, aus dem nur abgeholt wurde, aber keines mit Protokoll der Aktionen (409)", async () => {
    const abgeholt = await quelle("abgeholt@example.org");
    p.einliefern("abgeholt@example.org", mailRoh(1, "abgeholt"));
    expect((await senden("POST", `/api/quellen/${abgeholt}/abrufen`)).status).toBe(200);
    expect((await senden("DELETE", `/api/quellen/${abgeholt}`)).status).toBe(204);

    const mitAktion = await quelle("aktion@example.org");
    expect((await senden("POST", `/api/quellen/${mitAktion}/aktion`, { aktion: "gelesen" })).status).toBe(200);
    p.einliefern("aktion@example.org", mailRoh(1, "aktion"));
    expect((await senden("POST", `/api/quellen/${mitAktion}/abrufen`)).status).toBe(200);
    const res = await senden("DELETE", `/api/quellen/${mitAktion}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { fehler: string }).fehler).toMatch(/Deaktivieren statt Entfernen/);
    expect(await t.sql`select 1 from quellen where id = ${mitAktion}`).toHaveLength(1);
  });

  it("lässt Ändern und Entfernen nur den Inhaber mit Sitzung, nicht Steuerberatung oder Token", async () => {
    const id = await quelle("geschuetzt@example.org");
    const { pfad } = await (await senden("POST", "/api/einladungen", { rolle: "steuerberatung" })).json();
    const kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    const { klartext } = await (await senden("POST", "/api/tokens", { name: "t", recht: "schreiben" })).json();
    const kopf = { authorization: `Bearer ${klartext}`, "content-type": "application/json" };
    expect((await senden("PATCH", `/api/quellen/${id}`, { name: "x" }, kanzlei)).status).toBe(403);
    expect((await senden("DELETE", `/api/quellen/${id}`, undefined, kanzlei)).status).toBe(403);
    expect(
      (await t.anfrage(`/api/quellen/${id}`, { method: "PATCH", headers: kopf, body: '{"name":"x"}' })).status,
    ).toBe(403);
    expect((await t.anfrage(`/api/quellen/${id}`, { method: "DELETE", headers: kopf })).status).toBe(403);
    expect(await zeile(id)).toMatchObject({ name: "geschuetzt@example.org" });
  });
});

describe.skipIf(!testDatenbankUrl)("Postfach ändern ohne BELEGT_SCHLUESSEL", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  beforeAll(async () => {
    t = await testApp({ ohneSchluessel: true });
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("lehnt ein neues Passwort mit 503 ab, ändert ohne Passwort aber weiter", async () => {
    const id = (
      await t.sql<{ id: string }[]>`insert into quellen (name, host, benutzer, ciphertext)
      values ('ohne', 'imap.example.org', 'ohne@example.org', '\\x00') returning id`
    )[0]!.id;
    const aendern = (body: unknown) =>
      t.anfrage(
        `/api/quellen/${id}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        inhaber,
      );
    const res = await aendern({ host: "neu.example.org", passwort: "neues-passwort-1" });
    expect(res.status).toBe(503);
    expect((await t.sql`select host from quellen where id = ${id}`)[0]).toEqual({ host: "imap.example.org" });
    expect((await aendern({ name: "Umbenannt" })).status).toBe(200);
  });
});
