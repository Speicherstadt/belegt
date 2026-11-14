import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

const crlf = (zeilen: string[]) => zeilen.join("\r\n");
const PDF = "%PDF-1.7\n% erfundene Rechnung\n";

function mail({
  id,
  betreff,
  von = "rechnung@telekom.de",
  antwort,
  verweise,
  anhang = false,
}: {
  id: string;
  betreff: string;
  von?: string;
  antwort?: string;
  verweise?: string;
  anhang?: boolean;
}) {
  const kopf = [
    `From: ${von}`,
    "To: anna@example.org",
    `Subject: ${betreff}`,
    "Date: Tue, 03 Nov 2026 08:12:04 +0100",
    `Message-ID: ${id}`,
  ];
  if (antwort) kopf.push(`In-Reply-To: ${antwort}`);
  if (verweise) kopf.push(`References: ${verweise}`);
  if (!anhang) return crlf([...kopf, "", "Nur Text."]);
  return crlf([
    ...kopf,
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
    Buffer.from(PDF).toString("base64"),
    "--g--",
    "",
  ]);
}

describe.skipIf(!testDatenbankUrl)("Mail-Import gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  async function importieren(inhalt: string, name = "mail.eml") {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], name));
    return anfrage("/api/mails", { method: "POST", body: form });
  }

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("nimmt die Mail unverändert auf, ihre Angaben und jeden Anhang als eigenes Dokument", async () => {
    const roh = mail({ id: "<r-1@telekom.de>", betreff: "Ihre Rechnung: November/2026", anhang: true });
    const res = await importieren(roh);
    expect(res.status).toBe(201);
    const { neu, doppelt } = await res.json();
    expect(neu).toHaveLength(1);
    expect(doppelt).toEqual([]);

    const original = await (await anfrage(`/api/dokumente/${neu[0]}`)).json();
    expect(original).toMatchObject({
      mimeType: "message/rfc822",
      quelle: "mail",
      dateiname: "Ihre Rechnung November 2026.eml",
      sha256: createHash("sha256").update(roh).digest("hex"),
    });
    expect(Buffer.from(await (await anfrage(`/api/dokumente/${neu[0]}/datei`)).arrayBuffer()).toString()).toBe(roh);

    const m = await (await anfrage(`/api/dokumente/${neu[0]}/mail`)).json();
    expect(m).toMatchObject({
      von: "rechnung@telekom.de",
      an: ["anna@example.org"],
      betreff: "Ihre Rechnung: November/2026",
      text: "Anbei die Rechnung.",
    });
    expect(m.anhaenge).toEqual([
      expect.objectContaining({ dateiname: "Rechnung.pdf", mimeType: "application/pdf", eingebettet: false }),
    ]);
    const anhang = await (await anfrage(`/api/dokumente/${m.anhaenge[0].dokumentId}/datei`)).text();
    expect(anhang).toBe(PDF);
    expect((await (await anfrage(`/api/dokumente/${m.anhaenge[0].dokumentId}/mail`)).json()).ausMail).toBe(neu[0]);

    for (const tabelle of ["mails", "mail_anhaenge"])
      expect(await t.sql`select 1 from seals where table_name = ${tabelle}`).toHaveLength(1);
    await expect(t.sql`update mails set betreff = 'anders'`).rejects.toThrow(/darf nur ergänzt werden/);
  });

  it("nimmt dieselbe Mail nicht zweimal auf", async () => {
    const roh = mail({ id: "<doppelt@x>", betreff: "Zweimal" });
    const erst = await (await importieren(roh)).json();
    const zweit = await (await importieren(roh)).json();
    expect(zweit).toEqual({ neu: [], doppelt: erst.neu });
  });

  it("nimmt eine Mail mit Nullzeichen in Text, Betreff und Dateiname des Anhangs auf (Postgres speichert sie nicht)", async () => {
    const roh = crlf([
      "From: a@example.org",
      "To: anna@example.org",
      "Subject: =?utf-8?Q?Null=00zeichen?=",
      "Message-ID: <null@x>",
      'Content-Type: multipart/mixed; boundary="g"',
      "",
      "--g",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hallo\u0000Welt",
      "--g",
      'Content-Type: application/pdf; name="=?utf-8?Q?a=00b.pdf?="',
      'Content-Disposition: attachment; filename="=?utf-8?Q?a=00b.pdf?="',
      "",
      "PDF",
      "--g--",
      "",
    ]);
    const res = await importieren(roh);
    expect(res.status).toBe(201);
    const { neu } = await res.json();
    const m = await (await anfrage(`/api/dokumente/${neu[0]}/mail`)).json();
    expect(m).toMatchObject({ betreff: "Nullzeichen", text: "HalloWelt" });
    expect(m.anhaenge).toEqual([expect.objectContaining({ dateiname: "ab.pdf" })]);
    expect(Buffer.from(await (await anfrage(`/api/dokumente/${neu[0]}/datei`)).arrayBuffer()).toString()).toBe(roh);
  });

  it("teilt ein MBOX-Archiv und hält eine Unterhaltung über die Message-IDs zusammen", async () => {
    const a = mail({ id: "<frage@kunde.de>", von: "kunde@kunde.de", betreff: "Angebot?" });
    const b = mail({
      id: "<antwort@firma.de>",
      von: "anna@example.org",
      betreff: "Re: Angebot?",
      antwort: "<frage@kunde.de>",
      verweise: "<frage@kunde.de>",
    });
    const mbox = `From kunde@kunde.de Mon Nov  2 10:00:00 2026\n${a}\n\nFrom anna@example.org Mon Nov  2 11:00:00 2026\n${b}\n`;
    const { neu } = await (await importieren(mbox, "archiv.mbox")).json();
    expect(neu).toHaveLength(2);
    const m = await (await anfrage(`/api/dokumente/${neu[0]}/mail`)).json();
    expect(m.unterhaltung.map((u: { betreff: string }) => u.betreff).sort()).toEqual(["Angebot?", "Re: Angebot?"]);
  });

  it("schlägt per Regel eine Art vor, auch für den Anhang", async () => {
    const regel = await anfrage("/api/regeln", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Telekom-Rechnungen",
        wenn: { domain: "telekom.de", anhangTyp: "application/pdf" },
        dann: "beleg",
      }),
    });
    expect(regel.status).toBe(201);
    const { neu } = await (
      await importieren(mail({ id: "<r-2@telekom.de>", betreff: "Rechnung Dezember", anhang: true }))
    ).json();
    expect((await (await anfrage(`/api/dokumente/${neu[0]}/vorschlag`)).json()).vorschlag).toMatchObject({
      art: "beleg",
      regel: { name: "Telekom-Rechnungen" },
    });
    const m = await (await anfrage(`/api/dokumente/${neu[0]}/mail`)).json();
    expect((await (await anfrage(`/api/dokumente/${m.anhaenge[0].dokumentId}/vorschlag`)).json()).vorschlag?.art).toBe(
      "beleg",
    );

    const { id } = await regel.json();
    await anfrage(`/api/regeln/${id}/deaktivieren`, { method: "POST" });
    expect((await (await anfrage(`/api/dokumente/${neu[0]}/vorschlag`)).json()).vorschlag).toBeNull();
    expect(
      (
        await anfrage("/api/regeln", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "leer", wenn: {}, dann: "frei" }),
        })
      ).status,
    ).toBe(400);
  });

  it("hat nach allem eine intakte Kette", async () => {
    expect(await (await anfrage("/api/pruefung")).json()).toMatchObject({ ok: true, befunde: [] });
  });
});
