import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { aktionenAusfuehren } from "./aktionen-ausfuehren.ts";
import { mailRoh, testPostfaecher } from "./test-postfach.ts";

/*
 * Löschen im Postfach nach dem Abholen: nur ausdrücklich bestätigt, erst nach der Wartezeit, auf Wunsch erst mit Sperre
 * im Bucket, und nur, was Byte für Byte dem Original im Archiv gleicht. Dazu, wer Aktionen einstellen darf.
 */
describe.skipIf(!testDatenbankUrl)("Löschen im Postfach über IMAP", () => {
  const p = testPostfaecher();
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const STUNDE = 3_600_000;
  const anfrage = (pfad: string, init: RequestInit = {}, mit = cookie) => t.anfrage(pfad, init, mit);
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
  const einstellen = (id: string, aktion: Record<string, unknown>, mit = cookie) =>
    anfrage(`/api/quellen/${id}/aktion`, json(aktion), mit);
  const abholen = async (id: string) => (await anfrage(`/api/quellen/${id}/abrufen`, { method: "POST" })).json();
  const ausfuehren = (id: string, jetzt: Date) =>
    aktionenAusfuehren({ db: t.db, speicher: t.speicher }, t.schluessel, id, p.oeffnen, { jetzt });

  beforeAll(async () => {
    t = await testApp({ oeffnen: p.oeffnen, objektsperre: true });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("lehnt Löschen ohne ausdrückliche Bestätigung ab, auch in der Datenbank", async () => {
    const id = await quelle("ohne@example.org");
    const res = await einstellen(id, { aktion: "loeschen" });
    expect(res.status).toBe(400);
    expect((await res.json()).fehler).toContain("bestätigt");
    expect((await einstellen(id, { aktion: "loeschen", loeschenBestaetigt: false })).status).toBe(400);
    await expect(t.sql`update quellen set aktion = 'loeschen' where id = ${id}`).rejects.toThrow(
      /quellen_loeschen_bestaetigt/,
    );
    const [q] = await t.sql`select aktion from quellen where id = ${id}`;
    expect(q!.aktion).toBe("keine");
  });

  it("löscht erst nach der Wartezeit und hält fest, wer bestätigt hat", async () => {
    const benutzer = "loeschen@example.org";
    const id = await quelle(benutzer);
    const res = await einstellen(id, { aktion: "loeschen", warteStunden: 24, loeschenBestaetigt: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      aktion: "loeschen",
      loeschenWarteStunden: 24,
      loeschenBestaetigtVon: "nutzer:anna@example.org",
    });
    const [audit] = await t.sql`select actor, new_value from audit_log where table_name = 'quellen'
                                 order by seq desc limit 1`;
    expect(audit).toMatchObject({ actor: "nutzer:anna@example.org", new_value: { aktion: "loeschen" } });
    p.einliefern(benutzer, mailRoh(1, "loeschen"));
    await abholen(id);
    const jetzt = new Date();
    expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(await ausfuehren(id, new Date(jetzt.getTime() + 23 * STUNDE))).toEqual({
      ausgefuehrt: 0,
      entfallen: 0,
      fehler: 0,
    });
    expect(p.konto(benutzer).ordner.get("INBOX")!.mails.size).toBe(1);
    expect(await ausfuehren(id, new Date(jetzt.getTime() + 25 * STUNDE))).toEqual({
      ausgefuehrt: 1,
      entfallen: 0,
      fehler: 0,
    });
    expect(p.konto(benutzer).aufrufe).toEqual(["loeschen 1"]);
    expect(p.konto(benutzer).ordner.get("INBOX")!.mails.size).toBe(0);
    // Im Archiv bleibt die Mail
    const [d] =
      await t.sql`select count(*)::int as n from mails m join postfach_mails pm on pm.dokument_id = m.dokument_id
                             where pm.quelle_id = ${id}`;
    expect(d!.n).toBe(1);
    const { eintraege, stand } = await (await anfrage(`/api/quellen/${id}/aktionen`)).json();
    expect(stand).toMatchObject({ erledigt: 1, offen: 0 });
    expect(eintraege).toMatchObject([{ aktion: "loeschen", ergebnis: "ausgefuehrt", uid: 1 }]);
    // Ein zweiter Lauf tut nichts mehr
    expect(await ausfuehren(id, new Date(jetzt.getTime() + 48 * STUNDE))).toEqual({
      ausgefuehrt: 0,
      entfallen: 0,
      fehler: 0,
    });
  });

  it("löscht nicht, wenn die Mail im Postfach vom Original abweicht", async () => {
    const benutzer = "abweichung@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "loeschen", warteStunden: 1, loeschenBestaetigt: true });
    const uid = p.einliefern(benutzer, mailRoh(1, "abweichung"));
    await abholen(id);
    p.konto(benutzer).ordner.get("INBOX")!.mails.get(uid)!.roh = mailRoh(2, "abweichung");
    expect(await ausfuehren(id, new Date(Date.now() + 2 * STUNDE))).toEqual({
      ausgefuehrt: 0,
      entfallen: 0,
      fehler: 1,
    });
    const [e] = await t.sql`select status from postfach_mails where quelle_id = ${id}`;
    expect(e!.status).toBe("fehlgeschlagen");
    expect(p.konto(benutzer).aufrufe).toEqual([]);
  });

  it("löscht nicht, wenn die Mail im Archiv gelöscht ist, auch wenn die Datei noch im Speicher liegt", async () => {
    const benutzer = "archivgeloescht@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "loeschen", warteStunden: 1, loeschenBestaetigt: true });
    const roh = mailRoh(1, "archivgeloescht");
    p.einliefern(benutzer, roh);
    await abholen(id);
    const [e] = await t.sql`select dokument_id from postfach_mails where quelle_id = ${id}`;
    await anfrage(`/api/dokumente/${e!.dokument_id}/einordnung`, json({ art: "frei", entstanden: "2026-01-02" }));
    expect((await anfrage(`/api/dokumente/${e!.dokument_id}/loeschung`, { method: "POST" })).status).toBe(201);
    // Das Entfernen der Datei läuft nach der Löschung und kann scheitern (offene Entfernung, S3 noch gesperrt)
    await t.speicher.speichern(roh);
    expect(await ausfuehren(id, new Date(Date.now() + 2 * STUNDE))).toMatchObject({ ausgefuehrt: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual([]);
    expect(p.konto(benutzer).ordner.get("INBOX")!.mails.size).toBe(1);
  });

  it("löscht mit „erst nach Sperre“ erst, wenn die Datei im Bucket gesperrt ist", async () => {
    const benutzer = "sperre@example.org";
    const id = await quelle(benutzer);
    await einstellen(id, { aktion: "loeschen", warteStunden: 1, nachSperre: true, loeschenBestaetigt: true });
    p.einliefern(benutzer, mailRoh(1, "sperre"));
    await abholen(id);
    const spaeter = new Date(Date.now() + 2 * STUNDE);
    expect(await ausfuehren(id, spaeter)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    const [e] = await t.sql`select sha256 from postfach_mails where quelle_id = ${id}`;
    await t.sql`insert into objektsperren (sha256, bis) values (${e!.sha256}, current_date + 3650)`;
    expect(await ausfuehren(id, spaeter)).toEqual({ ausgefuehrt: 1, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual(["loeschen 1"]);
    expect((await (await anfrage(`/api/quellen/${id}/aktionen`)).json()).objektsperre).toBe(true);
  });

  it("behandelt Verschieben in den Papierkorb wie Löschen: Bestätigung, Wartezeit, gleicher Inhalt", async () => {
    const benutzer = "papierkorb@example.org";
    const id = await quelle(benutzer);
    p.konto(benutzer).ordner.set("Papierkorb", p.neuerOrdner());
    const ohne = await einstellen(id, { aktion: "verschieben", ziel: "Papierkorb" });
    expect(ohne.status).toBe(400);
    expect((await ohne.json()).fehler).toContain("bestätigt");
    const res = await einstellen(id, {
      aktion: "verschieben",
      ziel: "Papierkorb",
      warteStunden: 24,
      loeschenBestaetigt: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ loeschenBestaetigtVon: "nutzer:anna@example.org" });
    p.einliefern(benutzer, mailRoh(1, "papierkorb"));
    const geaendert = p.einliefern(benutzer, mailRoh(2, "papierkorb"));
    await abholen(id);
    p.konto(benutzer).ordner.get("INBOX")!.mails.get(geaendert)!.roh = mailRoh(3, "papierkorb");
    const jetzt = new Date();
    expect(await ausfuehren(id, jetzt)).toEqual({ ausgefuehrt: 0, entfallen: 0, fehler: 0 });
    expect(p.konto(benutzer).aufrufe).toEqual([]);
    expect(await ausfuehren(id, new Date(jetzt.getTime() + 25 * STUNDE))).toEqual({
      ausgefuehrt: 1,
      entfallen: 0,
      fehler: 1,
    });
    expect(p.konto(benutzer).aufrufe).toEqual(["verschieben 1 Papierkorb"]);
    // Auch an der Datenbank vorbei nicht ohne Bestätigung
    await expect(
      t.sql`update quellen set loeschen_bestaetigt_von = null, loeschen_bestaetigt_am = null where id = ${id}`,
    ).rejects.toThrow(/quellen_papierkorb_bestaetigt/);
  });

  it("verschiebt nicht in einen Papierkorb, der ohne Bestätigung als Ziel eingetragen ist", async () => {
    const benutzer = "papierkorb-sql@example.org";
    const id = await quelle(benutzer);
    p.konto(benutzer).ordner.set("Trash", p.neuerOrdner());
    await t.sql`update quellen set aktion = 'verschieben', aktion_ziel = 'Trash', aktion_ziel_pfad = 'Trash'
                 where id = ${id}`;
    p.einliefern(benutzer, mailRoh(1, "papierkorb-sql"));
    await abholen(id);
    expect(await ausfuehren(id, new Date(Date.now() + 25 * STUNDE))).toMatchObject({ ausgefuehrt: 0, fehler: 1 });
    expect(p.konto(benutzer).aufrufe).toEqual([]);
  });

  it("nimmt die Bestätigung mit einer anderen Aktion zurück", async () => {
    const id = await quelle("zurueck@example.org");
    await einstellen(id, { aktion: "loeschen", loeschenBestaetigt: true });
    expect(await (await einstellen(id, { aktion: "gelesen" })).json()).toMatchObject({
      aktion: "gelesen",
      loeschenBestaetigtVon: null,
      loeschenBestaetigtAm: null,
    });
  });

  it("nennt in der Verfahrensdokumentation je Postfach die Aktion, beim Löschen Wartezeit und Bestätigung", async () => {
    const doku = JSON.stringify(await (await anfrage("/api/verfahrensdoku")).json());
    expect(doku).toContain(
      "Postfach „loeschen@example.org“: loeschen@example.org auf imap.example.org, Ordner INBOX; nach dem Abholen: löschen, frühestens 24 Stunden nach der Archivierung; ausdrücklich bestätigt von nutzer:anna@example.org am",
    );
    expect(doku).toContain("nach dem Abholen: löschen, frühestens 1 Stunde nach der Archivierung und erst mit Sperre");
    expect(doku).toContain(
      "Postfach „ohne@example.org“: ohne@example.org auf imap.example.org, Ordner INBOX; nach dem Abholen: keine Aktion, nur lesend",
    );
    expect(doku).toContain(
      "Löschen im Postfach, auch Verschieben in einen Papierkorb, muss der Inhaber ausdrücklich bestätigen",
    );
    expect(doku).toContain(
      "nach dem Abholen: in den Papierkorb „Papierkorb“ verschieben, wie Löschen frühestens 24 Stunden nach der Archivierung; ausdrücklich bestätigt von nutzer:anna@example.org am",
    );
  });

  it("lässt nur den Inhaber mit Sitzung Aktionen einstellen und Ordner sehen", async () => {
    const id = await quelle("rechte@example.org");
    const steuerberatung = await zugangAnlegen(t, cookie, "stb@example.org", { rolle: "steuerberatung" });
    const token = await tokenAnlegen(t, cookie, "schreiben");
    expect((await einstellen(id, { aktion: "gelesen" }, steuerberatung)).status).toBe(403);
    expect((await anfrage(`/api/quellen/${id}/ordner`, {}, steuerberatung)).status).toBe(403);
    const mitToken = await t.app.request(`http://localhost:3000/api/quellen/${id}/aktion`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ aktion: "loeschen", loeschenBestaetigt: true }),
    });
    expect(mitToken.status).toBe(403);
    const [q] = await t.sql`select aktion from quellen where id = ${id}`;
    expect(q!.aktion).toBe("keine");
    // Lesen darf die Steuerberatung das Protokoll
    expect((await anfrage(`/api/quellen/${id}/aktionen`, {}, steuerberatung)).status).toBe(200);
  });
});
