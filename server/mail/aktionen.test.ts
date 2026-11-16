import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { abrufen } from "./abruf.ts";
import { aktionenAusfuehren, VERSUCHE } from "./aktionen-ausfuehren.ts";
import { mailRoh, testPostfaecher } from "./test-postfach.ts";

/*
 * Aktionen nach dem Abholen über IMAP, gegen einen nachgebauten Server (test-postfach.ts): jede Aktion erst nach der
 * Archivierung, idempotent, mit Protokoll, Fehlern und Wiederholung. Löschen steht in aktionen-loeschen.test.ts.
 */
describe.skipIf(!testDatenbankUrl)("Aktionen im Postfach über IMAP", () => {
  const p = testPostfaecher();
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const json = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function quelle(benutzer: string) {
    const res = await anfrage(
      "/api/quellen",
      json({ name: benutzer, host: "imap.example.org", benutzer, passwort: "geheim-123" }),
    );
    return ((await res.json()) as { id: string }).id;
  }
  const einstellen = (id: string, aktion: Record<string, unknown>) =>
    anfrage(`/api/quellen/${id}/aktion`, json(aktion));
  const abholen = async (id: string) => (await anfrage(`/api/quellen/${id}/abrufen`, { method: "POST" })).json();
  const ausfuehren = (id: string, jetzt = new Date()) =>
    aktionenAusfuehren({ db: t.db, speicher: t.speicher }, t.schluessel, id, p.oeffnen, { jetzt });
  const eintraege = (id: string) =>
    t.sql`select status, versuche, uid::int, uid_validity::int as "uidValidity", letzter_fehler as fehler
            from postfach_mails where quelle_id = ${id} order by uid_validity, uid`;
  const protokoll = (id: string) =>
    t.sql`select aktion, ergebnis, meldung, uid::int, ziel from postfach_aktionen where quelle_id = ${id}
           order by zeit, id`;

  beforeAll(async () => {
    t = await testApp({ oeffnen: p.oeffnen });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("tut ohne eingestellte Aktion nichts im Postfach und merkt nichts vor", async () => {
    const id = await quelle("keine@example.org");
    p.einliefern("keine@example.org", mailRoh(1, "keine"));
    expect(await abholen(id)).toEqual({ neu: 1, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(await eintraege(id)).toEqual([]);
    expect(p.konto("keine@example.org").aufrufe).toEqual([]);
  });

  it("markiert erst nach der Archivierung als gelesen, einmal, und protokolliert es", async () => {
    const id = await quelle("gelesen@example.org");
    expect((await einstellen(id, { aktion: "gelesen" })).status).toBe(200);
    p.einliefern("gelesen@example.org", mailRoh(1, "gelesen"));
    p.einliefern("gelesen@example.org", mailRoh(2, "gelesen"));
    // Vor dem Abruf gibt es nichts zu tun, auch nicht für die Mails im Postfach
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    await abholen(id);
    // Vorgemerkt sind nur Mails, deren Dokument im Archiv liegt
    const [archiv] = await t.sql`select count(*)::int as n from postfach_mails pm
                                   join dokumente d on d.id = pm.dokument_id and d.sha256 = pm.sha256
                                   join mails m on m.dokument_id = d.id where pm.quelle_id = ${id}`;
    expect(archiv!.n).toBe(2);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 2, entfallen: 0, fehler: 0 });
    expect(p.konto("gelesen@example.org").aufrufe).toEqual(["flagge 1 \\Seen", "flagge 2 \\Seen"]);
    // Ein zweiter Lauf und ein zweiter Abruf ändern nichts mehr
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(await abholen(id)).toEqual({ neu: 0, doppelt: 0, anhaengeVorhanden: 0, fehler: null });
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(p.konto("gelesen@example.org").aufrufe).toHaveLength(2);
    expect(await eintraege(id)).toMatchObject([
      { status: "erledigt", uid: 1 },
      { status: "erledigt", uid: 2 },
    ]);
    expect(await protokoll(id)).toEqual([
      { aktion: "gelesen", ergebnis: "ausgefuehrt", meldung: null, uid: 1, ziel: null },
      { aktion: "gelesen", ergebnis: "ausgefuehrt", meldung: null, uid: 2, ziel: null },
    ]);
    const audit = await t.sql`select actor from audit_log where table_name = 'postfach_aktionen'`;
    expect(audit.map((a) => a.actor)).toEqual(["system:imap:gelesen@example.org", "system:imap:gelesen@example.org"]);
  });

  it("markiert mit Flagge und nimmt eine Mail, die schon im Archiv lag, genauso", async () => {
    const id = await quelle("flagge@example.org");
    await einstellen(id, { aktion: "markieren" });
    // Dieselbe Mail kam vorher über einen Import ins Archiv: doppelt, Hash gleich, also darf die Aktion laufen
    const form = new FormData();
    form.append("datei", new File([mailRoh(1, "flagge")], "flagge.eml"));
    expect((await anfrage("/api/mails", { method: "POST", body: form })).status).toBe(201);
    p.einliefern("flagge@example.org", mailRoh(1, "flagge"));
    expect(await abholen(id)).toEqual({ neu: 0, doppelt: 1, anhaengeVorhanden: 0, fehler: null });
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(p.konto("flagge@example.org").aufrufe).toEqual(["flagge 1 \\Flagged"]);
  });

  it("verschiebt nur in einen Ordner, den es gibt, und hält einen später fehlenden Ordner als Fehler fest", async () => {
    const benutzer = "verschieben@example.org";
    const id = await quelle(benutzer);
    const ordner = await (await anfrage(`/api/quellen/${id}/ordner`)).json();
    expect(ordner).toEqual({ ordner: [{ id: "INBOX", pfad: "INBOX", papierkorb: false }] });
    const fehlt = await einstellen(id, { aktion: "verschieben", ziel: "Archiv" });
    expect(fehlt.status).toBe(400);
    expect((await fehlt.json()).fehler).toContain("Archiv");
    expect((await einstellen(id, { aktion: "verschieben" })).status).toBe(400);
    p.konto(benutzer).ordner.set("Archiv", p.neuerOrdner());
    expect((await einstellen(id, { aktion: "verschieben", ziel: "Archiv" })).status).toBe(200);
    p.einliefern(benutzer, mailRoh(1, "verschieben"));
    p.einliefern(benutzer, mailRoh(2, "verschieben"));
    await abholen(id);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 2, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).ordner.get("INBOX")!.mails.size).toBe(0);
    expect(p.konto(benutzer).ordner.get("Archiv")!.mails.size).toBe(2);
    expect((await protokoll(id))[0]).toMatchObject({ aktion: "verschieben", ziel: "Archiv", ergebnis: "ausgefuehrt" });

    // Der Ordner verschwindet: Fehler festgehalten, begrenzt wiederholt, danach fehlgeschlagen
    p.konto(benutzer).ordner.delete("Archiv");
    p.einliefern(benutzer, mailRoh(3, "verschieben"));
    await abholen(id);
    let jetzt = new Date();
    expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 1 });
    expect((await eintraege(id))[2]).toMatchObject({
      status: "offen",
      versuche: 1,
      fehler: "Zielordner „Archiv“ gibt es nicht",
    });
    // Vor dem nächsten Versuch nichts
    expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    for (let i = 2; i <= VERSUCHE; i++) {
      jetzt = new Date(jetzt.getTime() + 24 * 3_600_000);
      expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 1 });
    }
    expect((await eintraege(id))[2]).toMatchObject({ status: "fehlgeschlagen", versuche: VERSUCHE });
    jetzt = new Date(jetzt.getTime() + 24 * 3_600_000);
    expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toHaveLength(2);
  });

  it("lässt eine Mail aus, die nicht mehr im Ordner liegt", async () => {
    const benutzer = "weg@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "gelesen" });
    const uid = p.einliefern(benutzer, mailRoh(1, "weg"));
    await abholen(id);
    p.konto(benutzer).ordner.get("INBOX")!.mails.delete(uid);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 1, fehler: 0 });
    expect(await protokoll(id)).toMatchObject([
      { ergebnis: "entfallen", meldung: "Die Mail liegt nicht mehr im Ordner" },
    ]);
    expect(p.konto(benutzer).aufrufe).toEqual([]);
  });

  it("adressiert nach einem Wechsel der UIDVALIDITY keine alte UID, sondern die neu zugeordnete Mail", async () => {
    const benutzer = "uidvalidity@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "markieren" });
    p.einliefern(benutzer, mailRoh(1, "uv"));
    p.einliefern(benutzer, mailRoh(2, "uv"));
    await abholen(id);
    // Der Server nummeriert neu: die alte UID 2 ist jetzt eine andere Mail
    p.konto(benutzer).ordner.get("INBOX")!.mails.delete(1);
    p.neuNummerieren(benutzer);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 2, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual([]);
    // Der nächste Abruf beginnt von vorn, erkennt die Mail als doppelt und merkt sie mit der neuen UID vor
    expect(await abholen(id)).toEqual({ neu: 0, doppelt: 1, anhaengeVorhanden: 0, fehler: null });
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual(["flagge 1 \\Flagged"]);
    const neu = p.konto(benutzer).ordner.get("INBOX")!.mails.get(1)!;
    expect(new TextDecoder().decode(neu.roh)).toContain("uv 2");
  });

  it("führt bei einem Speicherfehler keine Aktion aus", async () => {
    const benutzer = "speicher@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "gelesen" });
    p.einliefern(benutzer, mailRoh(1, "speicher"));
    const kaputt = {
      ...t.speicher,
      speichern: async () => {
        throw new Error("Platte voll");
      },
    };
    const r = await abrufen({ db: t.db, speicher: kaputt }, t.schluessel, id, p.oeffnen);
    expect(r).toEqual({ neu: 0, doppelt: 0, anhaengeVorhanden: 0, fehler: "Platte voll" });
    expect(await eintraege(id)).toEqual([]);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual([]);
  });

  it("führt keine Aktion aus, wenn das Original im Speicher nicht mehr zum Hash passt", async () => {
    const benutzer = "hash@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "gelesen" });
    p.einliefern(benutzer, mailRoh(1, "hash"));
    await abholen(id);
    const [e] = await t.sql`select sha256 from postfach_mails where quelle_id = ${id}`;
    await writeFile(t.speicher.pfad(e!.sha256), "verändert");
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 1 });
    expect((await eintraege(id))[0]!.fehler).toContain("Original im Speicher nicht lesbar");
    expect(p.konto(benutzer).aufrufe).toEqual([]);
  });

  it("wiederholt nach einem Verbindungsabbruch, ohne etwas doppelt zu tun", async () => {
    const benutzer = "abbruch@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "markieren" });
    p.einliefern(benutzer, mailRoh(1, "abbruch"));
    p.einliefern(benutzer, mailRoh(2, "abbruch"));
    await abholen(id);
    p.konto(benutzer).schreibenFehler = 1;
    const jetzt = new Date();
    expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 2 });
    // Die erste Aktion kommt beim Server an, dann bricht die Verbindung ab
    p.konto(benutzer).abbruchNachAktion = true;
    const spaeter = new Date(jetzt.getTime() + 3_600_000);
    expect(await ausfuehren(id, spaeter)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 1 });
    // Markieren ist idempotent: der zweite Versuch setzt dieselbe Flagge noch einmal, sonst nichts
    expect(await ausfuehren(id, new Date(spaeter.getTime() + 3_600_000))).toEqual({
      ausgefuehrt: 1,
      entfallen: 0,
      fehler: 0,
    });
    expect(p.konto(benutzer).aufrufe).toEqual(["flagge 1 \\Flagged", "flagge 2 \\Flagged", "flagge 1 \\Flagged"]);
    expect(await eintraege(id)).toMatchObject([{ status: "erledigt" }, { status: "erledigt" }]);
  });

  it("lässt Offenes entfallen, wenn die Aktion abgeschaltet wird", async () => {
    const benutzer = "abgeschaltet@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "gelesen" });
    p.einliefern(benutzer, mailRoh(1, "ab"));
    await abholen(id);
    expect((await einstellen(id, { aktion: "keine" })).status).toBe(200);
    expect(await ausfuehren(id)).toEqual({ ausgefuehrt: 0, entfallen: 1, fehler: 0 });
    expect(await protokoll(id)).toMatchObject([{ aktion: "keine", ergebnis: "entfallen" }]);
    expect(p.konto(benutzer).aufrufe).toEqual([]);
  });

  it("hält das Protokoll unveränderlich und die Kette intakt", async () => {
    await expect(t.sql`update postfach_aktionen set ergebnis = 'fehler'`).rejects.toThrow();
    await expect(t.sql`delete from postfach_aktionen`).rejects.toThrow();
    const res = await anfrage(`/api/quellen/${await quelle("protokoll@example.org")}/aktionen`);
    expect(await res.json()).toEqual({
      stand: { offen: 0, erledigt: 0, entfallen: 0, fehlgeschlagen: 0 },
      eintraege: [],
      objektsperre: false,
    });
    // Ohne S3 mit Object Lock gäbe es nie eine Sperre: abgelehnt, statt nie zu löschen
    const ohneS3 = await einstellen(await quelle("ohne-s3@example.org"), {
      aktion: "loeschen",
      nachSperre: true,
      loeschenBestaetigt: true,
    });
    expect(ohneS3.status).toBe(400);
    expect(await (await anfrage("/api/pruefung")).json()).toMatchObject({ ok: true, befunde: [] });
  });
});
