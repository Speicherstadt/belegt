import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Volltextsuche gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const treffer = async (suche: string) =>
    (await (await anfrage(`/api/dokumente?suche=${encodeURIComponent(suche)}`)).json()).map(
      (d: { dateiname: string }) => d.dateiname,
    );

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    const mail = [
      "From: Stadtwerke <abrechnung@stadtwerke.example>",
      "To: anna@example.org",
      "Subject: Jahresabrechnung Strom",
      "Message-ID: <strom@stadtwerke.example>",
      'Content-Type: multipart/mixed; boundary="g"',
      "",
      "--g",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Ihre Verbrauchswerte und Abschläge für das kommende Jahr.",
      "--g",
      'Content-Type: application/pdf; name="Abrechnung.pdf"',
      'Content-Disposition: attachment; filename="Abrechnung.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.7\n").toString("base64"),
      "--g--",
      "",
    ].join("\r\n");
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(mail)], "strom.eml"));
    await anfrage("/api/mails", { method: "POST", body: form });

    const upload = new FormData();
    upload.append("datei", new File([new TextEncoder().encode("scan")], "scan-0412.pdf"));
    const scan = await (await anfrage("/api/dokumente", { method: "POST", body: upload })).json();
    await anfrage(`/api/dokumente/${scan.id}/einordnung`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ art: "beleg", entstanden: "2026-04-12", titel: "Tankquittung", korrespondent: "Aral" }),
    });
  });
  afterAll(() => t?.aufraeumen());

  it("findet eine Mail über ein Wort im Text, auch in anderer Form (deutsch)", async () => {
    expect(await treffer("Verbrauchswert")).toEqual(["Jahresabrechnung Strom.eml"]);
  });

  it("findet einen Anhang über den Betreff und den Absender seiner Mail", async () => {
    expect(await treffer("Jahresabrechnung")).toContain("Abrechnung.pdf");
    expect(await treffer("abrechnung@stadtwerke.example")).toContain("Abrechnung.pdf");
  });

  it("findet ein Dokument über Titel und Korrespondent seiner Einordnung", async () => {
    expect(await treffer("Tankquittung")).toEqual(["scan-0412.pdf"]);
    expect(await treffer("aral")).toEqual(["scan-0412.pdf"]);
  });

  it("versteht Anführungszeichen und Minus wie eine Suchmaschine und verschluckt sich nicht an Sonderzeichen", async () => {
    expect(await treffer('"kommende Jahr"')).toEqual(["Jahresabrechnung Strom.eml"]);
    expect(await treffer("Jahresabrechnung -Strom")).not.toContain("Jahresabrechnung Strom.eml");
    expect(await treffer("&|!():*")).toEqual([]);
  });
});
