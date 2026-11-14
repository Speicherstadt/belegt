import type { AddressInfo } from "node:net";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { smtpServer } from "./smtp.ts";

describe.skipIf(!testDatenbankUrl)("SMTP-Journal gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let server: ReturnType<typeof smtpServer>;
  let port: number;
  let schreiben: { id: string; klartext: string };
  let lesen: string;

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const roh = (betreff: string) =>
    [
      "From: Lieferant <rechnung@lieferant.example>",
      "To: archiv@belegt.example",
      `Subject: ${betreff}`,
      `Message-ID: <${betreff.replace(/\W/g, "")}@lieferant.example>`,
      "Date: Mon, 2 Nov 2026 09:00:00 +0100",
      "",
      "Anbei die Rechnung.",
      ".Zeile mit Punkt am Anfang",
      "",
    ].join("\r\n");

  function senden(passwort: string | null, betreff: string, an = "archiv@belegt.example") {
    const transport = nodemailer.createTransport({
      host: "127.0.0.1",
      port,
      secure: false,
      ignoreTLS: true,
      ...(passwort ? { auth: { user: "journal", pass: passwort } } : {}),
    });
    return transport.sendMail({ envelope: { from: "rechnung@lieferant.example", to: [an] }, raw: roh(betreff) });
  }

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const token = async (name: string, recht: string) =>
      (await (await t.anfrage("/api/tokens", json({ name, recht }), inhaber)).json()) as {
        id: string;
        klartext: string;
      };
    schreiben = await token("Stalwart", "schreiben");
    lesen = (await token("Nur lesen", "lesen")).klartext;
    server = smtpServer(t, { empfaenger: ["archiv@belegt.example"] });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((ok) => server?.close(ok));
    await t?.aufraeumen();
  });

  it("archiviert eine Mail Byte für Byte, mit dem Token als Akteur, und eine zweite gleiche einmal", async () => {
    const info = await senden(schreiben.klartext, "Rechnung November");
    expect(info.response).toMatch(/^250 .*Archiviert [0-9a-f-]{36}$/);
    const id = info.response.split(" ").pop()!;

    const datei = new Uint8Array(await (await t.anfrage(`/api/dokumente/${id}/datei`, {}, inhaber)).arrayBuffer());
    expect(new TextDecoder().decode(datei)).toBe(roh("Rechnung November"));
    const mail = await (await t.anfrage(`/api/dokumente/${id}/mail`, {}, inhaber)).json();
    expect(mail).toMatchObject({ betreff: "Rechnung November", von: "rechnung@lieferant.example" });
    const [eintrag] = await t.sql`select actor from audit_log where table_name = 'dokumente' and row_id = ${id}`;
    expect(eintrag!.actor).toBe("token:Stalwart");

    expect((await senden(schreiben.klartext, "Rechnung November")).response).toMatch(/Schon archiviert/);
  });

  it("verlangt ein Token mit dem Recht schreiben und lehnt fremde Empfänger ab", async () => {
    await expect(senden(null, "ohne Anmeldung")).rejects.toMatchObject({ responseCode: 530 });
    await expect(senden(lesen, "nur lesen")).rejects.toMatchObject({ responseCode: 535 });
    await expect(senden("belegt_falsch", "falsch")).rejects.toMatchObject({ responseCode: 535 });
    await expect(senden(schreiben.klartext, "fremd", "jemand@anders.example")).rejects.toMatchObject({
      responseCode: 550,
    });
    const [{ anzahl }] = (await t.sql`select count(*)::int as anzahl from mails`) as unknown as [{ anzahl: number }];
    expect(anzahl).toBe(1);
  });

  it("nimmt nach dem Widerruf des Tokens nichts mehr an", async () => {
    await t.anfrage(`/api/tokens/${schreiben.id}/widerrufen`, { method: "POST" }, inhaber);
    await expect(senden(schreiben.klartext, "nach Widerruf")).rejects.toMatchObject({ responseCode: 535 });
  });
});
