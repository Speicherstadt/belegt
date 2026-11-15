import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { klassifikatorLernen } from "./lernen.ts";

/*
 * Der gelernte Vorschlag für eingeschränkte Sichten (docs/zugaenge.md): Er nennt keine Zahl aus Dokumenten außerhalb
 * und keine Wörter aus einer Mail, die die Sicht nicht sieht.
 */
describe.skipIf(!testDatenbankUrl)("Gelernter Vorschlag und Sichtbereich", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const hoch = async (name: string) => {
    const f = new FormData();
    f.append("datei", new File([`%PDF-1.7\n% ${name}\n`], name));
    return ((await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json()) as { id: string }).id;
  };
  const anlegen = async (pfad: string, name: string) =>
    ((await (await als(inhaber)(pfad, json({ name }))).json()) as { id: string }).id;
  const ordnen = (id: string, aenderung: object) => als(inhaber)(`/api/dokumente/${id}/ordnung`, json(aenderung));
  type Gelernt = { korrespondent: { name: string; anzahl: number; woerter: string[] } | null } | null;
  const gelernt = async (cookie: string, id: string) =>
    ((await (await als(cookie)(`/api/dokumente/${id}/vorschlag`)).json()) as { gelernt: Gelernt }).gelernt;

  let personal: string;
  let projekt: string;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    personal = await anlegen("/api/tags", "Personal");
    projekt = await anlegen("/api/tags", "Projekt");
    // Zwölf Dokumente der Stadtwerke, neun davon Personal (für den Mitarbeiter unsichtbar), drei Projekt
    for (let i = 0; i < 12; i++) {
      const id = await hoch(`stadtwerke-strom-abschlag-geheimwort-${i}.pdf`);
      await als(inhaber)(
        `/api/dokumente/${id}/einordnung`,
        json({ art: "beleg", entstanden: "2026-01-02", korrespondent: "Stadtwerke" }),
      );
      await ordnen(id, { tagsHinzu: [i < 9 ? personal : projekt] });
    }
    await klassifikatorLernen(t.db, { immer: true });
  });
  afterAll(() => t?.aufraeumen());

  it("zählt für einen Mitarbeiter nur die Dokumente seines Sichtbereichs", async () => {
    const neu = await hoch("stadtwerke-strom-abschlag-neu.pdf");
    await ordnen(neu, { tagsHinzu: [projekt] });
    const m = await zugangAnlegen(t, inhaber, "zaehlen@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt] },
    });
    expect((await gelernt(inhaber, neu))?.korrespondent).toMatchObject({ name: "Stadtwerke", anzahl: 12 });
    expect((await gelernt(m, neu))?.korrespondent).toMatchObject({ name: "Stadtwerke", anzahl: 3 });
  });

  it("nennt bei einem Anhang keine Wörter aus seiner unsichtbaren Mail", async () => {
    const eml = [
      "From: Personal <hr@example.org>",
      "To: anna@example.org",
      "Subject: Geheimwort",
      "Message-ID: <geheimwort@example.org>",
      'Content-Type: multipart/mixed; boundary="g"',
      "",
      "--g",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Text.",
      "--g",
      'Content-Type: application/pdf; name="stadtwerke-strom-abschlag.pdf"',
      'Content-Disposition: attachment; filename="stadtwerke-strom-abschlag.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.7\n% Anhang\n").toString("base64"),
      "--g--",
      "",
    ].join("\r\n");
    const form = new FormData();
    form.append("datei", new File([eml], "geheim.eml"));
    const { neu } = await (await als(inhaber)("/api/mails", { method: "POST", body: form })).json();
    const mail = await (await als(inhaber)(`/api/dokumente/${neu[0]}/mail`)).json();
    const anhang = mail.anhaenge[0].dokumentId as string;
    await ordnen(neu[0], { tagsHinzu: [personal] });
    await ordnen(anhang, { tagsHinzu: [projekt] });
    const m = await zugangAnlegen(t, inhaber, "woerter@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt], ohneTags: [personal] },
    });
    // Der Inhaber sieht das Wort aus dem Betreff der Mail als Grund, der Mitarbeiter nicht
    expect((await gelernt(inhaber, anhang))?.korrespondent?.woerter).toContain("geheimwort");
    expect((await gelernt(m, anhang))?.korrespondent?.woerter).not.toContain("geheimwort");
  });
});
