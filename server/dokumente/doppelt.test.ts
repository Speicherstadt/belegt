import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";

const crlf = (zeilen: string[]) => zeilen.join("\r\n");
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Eine Mail mit einem Anhang „Rechnung.pdf“ */
function mailMitAnhang(id: string, anhang: string) {
  return crlf([
    "From: rechnung@stadtwerke.example",
    "To: anna@example.org",
    `Subject: Rechnung ${id}`,
    "Date: Tue, 03 Nov 2026 08:12:04 +0100",
    `Message-ID: <${id}@stadtwerke.example>`,
    'Content-Type: multipart/mixed; boundary="g"',
    "",
    "--g",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Anbei die Rechnung.",
    "--g",
    'Content-Type: application/pdf; name="Rechnung.pdf"',
    'Content-Disposition: attachment; filename="Rechnung.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(anhang).toString("base64"),
    "--g--",
    "",
  ]);
}

describe.skipIf(!testDatenbankUrl)("Doppelte Dateien gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  const datei = (inhalt: string, name: string, feld = "datei") => {
    const form = new FormData();
    form.append(feld, new File([new TextEncoder().encode(inhalt)], name));
    return form;
  };
  const hochladen = (cookie: string, inhalt: string, name: string, pfad = "/api/dokumente") =>
    als(cookie)(pfad, { method: "POST", body: datei(inhalt, name) });
  const anzahlMit = async (sha256: string) =>
    Number((await t.sql`select count(*) as n from dokumente where sha256 = ${sha256}`)[0]!.n);

  it("legt dieselbe Datei nicht zweimal an und antwortet 409 mit dem vorhandenen Dokument", async () => {
    const erst = await (await hochladen(inhaber, "%PDF-1.7 Stromrechnung Oktober", "strom.pdf")).json();
    const res = await hochladen(inhaber, "%PDF-1.7 Stromrechnung Oktober", "anderer-name.pdf");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      fehler: "Diese Datei liegt schon im Archiv",
      vorhanden: { id: erst.id, asn: erst.asn },
    });
    expect(await anzahlMit(erst.sha256)).toBe(1);
  });

  it("antwortet einem API-Token genauso, und auch ein Stapel zum Teilen kommt nicht zweimal", async () => {
    const token = await tokenAnlegen(t, inhaber, "schreiben");
    const mitToken = (form: FormData, pfad = "/api/dokumente") =>
      t.app.request(pfad, { method: "POST", body: form, headers: { authorization: `Bearer ${token}` } });
    const erst = await (await mitToken(datei("Quittung Baumarkt", "quittung.txt"))).json();
    const zweit = await mitToken(datei("Quittung Baumarkt", "quittung.txt"));
    expect(zweit.status).toBe(409);
    expect((await zweit.json()).vorhanden).toEqual({ id: erst.id, asn: erst.asn });
    const stapel = await mitToken(datei("Quittung Baumarkt", "quittung.txt"), "/api/dokumente?trennen=1");
    expect(stapel.status).toBe(409);
    expect((await stapel.json()).vorhanden.id).toBe(erst.id);
  });

  it("nimmt zwei gleichzeitige Uploads derselben Datei genau einmal auf", async () => {
    const antworten = await Promise.all(
      [1, 2, 3].map(() => hochladen(inhaber, "Gleichzeitig hochgeladen", "gleich.txt")),
    );
    expect(antworten.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it("zählt ein gelöschtes Dokument nicht: dieselbe Datei kommt danach wieder ins Archiv", async () => {
    const d = await (await hochladen(inhaber, "Werbung, frei abgelegt", "werbung.txt")).json();
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-11-01" }));
    // Frei Abgelegtes ist sofort gelöscht
    expect((await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    const neu = await hochladen(inhaber, "Werbung, frei abgelegt", "werbung.txt");
    expect(neu.status).toBe(201);
    expect((await neu.json()).id).not.toBe(d.id);
  });

  it("verrät einem Mitarbeiter nur, dass die Datei vorliegt, wenn er das vorhandene Dokument nicht sieht", async () => {
    const tag = async (name: string) =>
      (await (await als(inhaber)("/api/tags", json({ name, farbe: "blau" }))).json()).id as string;
    const projekt = await tag("Projekt Nord");
    const geheim = await tag("Personal");
    const mitarbeiter = await zugangAnlegen(t, inhaber, "max@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt] },
    });
    const verborgen = await (await hochladen(inhaber, "Arbeitsvertrag Max", "vertrag.pdf")).json();
    await als(inhaber)(
      `/api/dokumente/${verborgen.id}/ordnung`,
      json({ tagsHinzu: [geheim], tagsWeg: [], felder: [] }),
    );
    const sichtbar = await (await hochladen(inhaber, "Angebot Projekt Nord", "angebot.pdf")).json();
    await als(inhaber)(
      `/api/dokumente/${sichtbar.id}/ordnung`,
      json({ tagsHinzu: [projekt], tagsWeg: [], felder: [] }),
    );

    const versteckt = await hochladen(mitarbeiter, "Arbeitsvertrag Max", "kopie.pdf");
    expect(versteckt.status).toBe(409);
    expect(await versteckt.json()).toEqual({
      fehler: "Diese Datei liegt schon im Archiv",
      vorhanden: { id: null, asn: null },
    });
    const offen = await hochladen(mitarbeiter, "Angebot Projekt Nord", "angebot.pdf");
    expect((await offen.json()).vorhanden).toEqual({ id: sichtbar.id, asn: sichtbar.asn });
    expect(await anzahlMit(verborgen.sha256)).toBe(1);
  });

  it("archiviert eine Mail mit bekanntem Anhang als Mail; der Anhang verweist auf das vorhandene Dokument", async () => {
    const pdf = "%PDF-1.7 Rechnung 4711 der Stadtwerke";
    const vorhanden = await (await hochladen(inhaber, pdf, "4711.pdf")).json();
    const res = await als(inhaber)("/api/mails", {
      method: "POST",
      body: datei(mailMitAnhang("4711", pdf), "mail.eml"),
    });
    expect(res.status).toBe(201);
    const r = await res.json();
    expect(r).toMatchObject({ doppelt: [], anhaengeVorhanden: 1 });
    expect(r.neu).toHaveLength(1);
    expect(await anzahlMit(vorhanden.sha256)).toBe(1);

    const ansicht = await (await als(inhaber)(`/api/dokumente/${r.neu[0]}/mail`)).json();
    expect(ansicht.anhaenge).toEqual([
      {
        dokumentId: vorhanden.id,
        dateiname: "Rechnung.pdf",
        mimeType: "application/pdf",
        eingebettet: false,
        vorhanden: true,
      },
    ]);
    // Der Verweis ist versiegelt wie ein Anhang und steht im Audit-Log
    const [verweis] = await t.sql`select id from mail_verweise where mail_dokument_id = ${r.neu[0]}`;
    expect(
      await t.sql`select 1 from seals where table_name = 'mail_verweise' and row_id = ${verweis!.id}`,
    ).toHaveLength(1);
    await expect(t.sql`delete from mail_verweise where id = ${verweis!.id}`).rejects.toThrow();

    // Ein neuer Anhang in einer weiteren Mail wird ein Dokument wie bisher
    const zweite = await (
      await als(inhaber)("/api/mails", {
        method: "POST",
        body: datei(mailMitAnhang("4712", "%PDF-1.7 Rechnung 4712"), "mail.eml"),
      })
    ).json();
    expect(zweite.anhaengeVorhanden).toBe(0);
    const [anhang] =
      await t.sql`select anhang_dokument_id from mail_anhaenge where mail_dokument_id = ${zweite.neu[0]}`;
    expect(anhang).toBeDefined();
  });

  it("zeigt einem Mitarbeiter eine Mail nur, wenn er auch das Dokument sieht, auf das ihr Anhang verweist", async () => {
    const sued = (await (await als(inhaber)("/api/tags", json({ name: "Projekt Süd", farbe: "gruen" }))).json()).id;
    // Sieht Dokumente ohne Ordnung (also die Mail) und das Projekt Süd, nicht den Lohn
    const mitarbeiter = await zugangAnlegen(t, inhaber, "lea@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [sued], ohneOrdnung: true },
    });
    const pdf = "%PDF-1.7 Gehaltsabrechnung";
    const vorhanden = await (await hochladen(inhaber, pdf, "gehalt.pdf")).json();
    const tagId = (await (await als(inhaber)("/api/tags", json({ name: "Lohn", farbe: "rot" }))).json()).id;
    await als(inhaber)(`/api/dokumente/${vorhanden.id}/ordnung`, json({ tagsHinzu: [tagId], tagsWeg: [], felder: [] }));
    const r = await (
      await als(inhaber)("/api/mails", { method: "POST", body: datei(mailMitAnhang("lohn", pdf), "mail.eml") })
    ).json();
    expect((await als(mitarbeiter)(`/api/dokumente/${r.neu[0]}`)).status).toBe(404);
    // Ohne den Verweis sähe er sie: eine Mail mit neuem Anhang
    const offen = await (
      await als(inhaber)("/api/mails", { method: "POST", body: datei(mailMitAnhang("neu", "%PDF-1.7 neu"), "m.eml") })
    ).json();
    expect((await als(mitarbeiter)(`/api/dokumente/${offen.neu[0]}`)).status).toBe(200);
  });

  it("nimmt eine gelöschte Mail neu auf, statt sie als doppelt zu melden", async () => {
    const roh = mailMitAnhang("weg", "%PDF-1.7 Werbung als Anhang");
    const erst = await (await als(inhaber)("/api/mails", { method: "POST", body: datei(roh, "a.eml") })).json();
    await als(inhaber)(`/api/dokumente/${erst.neu[0]}/einordnung`, json({ art: "frei", entstanden: "2026-11-01" }));
    expect((await als(inhaber)(`/api/dokumente/${erst.neu[0]}/loeschung`, { method: "POST" })).status).toBe(201);
    const wieder = await (await als(inhaber)("/api/mails", { method: "POST", body: datei(roh, "a.eml") })).json();
    expect(wieder.doppelt).toEqual([]);
    expect(wieder.neu).toHaveLength(1);
    expect(wieder.neu[0]).not.toBe(erst.neu[0]);
  });
});
