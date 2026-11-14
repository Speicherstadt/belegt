import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emlLesen } from "./eml.ts";

const crlf = (zeilen: string[]) => new TextEncoder().encode(zeilen.join("\r\n"));
const sha = (s: Uint8Array | string) => createHash("sha256").update(s).digest("hex");

const PDF = "%PDF-1.7\n% erfundene Rechnung\n";

const rechnung = crlf([
  'From: "Muster Telekom" <Rechnung@Example.COM>',
  "To: Anna Schulz <anna@example.org>, Team: ben@example.org, carla@example.org;",
  "Cc: buchhaltung@example.org",
  "Subject: =?UTF-8?Q?Ihre_Rechnung_f=C3=BCr_November?=",
  "Date: Tue, 03 Nov 2026 08:12:04 +0100",
  "Message-ID: <r-123@example.com>",
  "In-Reply-To: <frage-1@example.org>",
  "References: <start-0@example.org> <frage-1@example.org>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="grenze"',
  "",
  "--grenze",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Guten Tag, anbei die Rechnung über 49,95 €.",
  "--grenze",
  'Content-Type: application/pdf; name="Rechnung-2026-11.pdf"',
  'Content-Disposition: attachment; filename="Rechnung-2026-11.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(PDF).toString("base64"),
  "--grenze--",
  "",
]);

describe("emlLesen", () => {
  it("liest Kopf, Text und Anhang und hasht Rohdaten und Anhang", async () => {
    const mail = await emlLesen(rechnung);
    expect(mail.sha256).toBe(sha(rechnung));
    expect(mail.von).toEqual({ name: "Muster Telekom", adresse: "rechnung@example.com" });
    expect(mail.an.map((p) => p.adresse)).toEqual(["anna@example.org", "ben@example.org", "carla@example.org"]);
    expect(mail.kopie.map((p) => p.adresse)).toEqual(["buchhaltung@example.org"]);
    expect(mail.betreff).toBe("Ihre Rechnung für November");
    expect(mail.datum).toBe("2026-11-03T07:12:04.000Z");
    expect(mail.messageId).toBe("<r-123@example.com>");
    expect(mail.antwortAuf).toBe("<frage-1@example.org>");
    expect(mail.verweise).toEqual(["<start-0@example.org>", "<frage-1@example.org>"]);
    expect(mail.text).toBe("Guten Tag, anbei die Rechnung über 49,95 €.");
    expect(mail.anhaenge).toEqual([
      {
        dateiname: "Rechnung-2026-11.pdf",
        mimeType: "application/pdf",
        groesse: PDF.length,
        sha256: sha(PDF),
        eingebettet: false,
      },
    ]);
  });

  it("nimmt den Text aus dem HTML, wenn es keinen Textteil gibt, ohne Skripte", async () => {
    const mail = await emlLesen(
      crlf([
        "From: news@example.com",
        "Subject: Angebot",
        "Content-Type: text/html; charset=utf-8",
        "",
        "<html><style>p{color:red}</style><script>alert(1)</script><p>Nur&nbsp;heute <b>30 %</b></p></html>",
      ]),
    );
    expect(mail.text).toBe("Nur heute 30 %");
  });

  it("kommt mit fehlenden und kaputten Köpfen zurecht", async () => {
    const mail = await emlLesen(crlf(["Date: irgendwann", "", "ohne alles"]));
    expect(mail).toMatchObject({
      von: null,
      an: [],
      betreff: "",
      datum: null,
      messageId: null,
      antwortAuf: null,
      verweise: [],
    });
    expect(mail.text).toBe("ohne alles");
  });
});
