import { describe, expect, it } from "vitest";
import { mboxAufteilen } from "./mbox.ts";

const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("mboxAufteilen", () => {
  it("trennt an den From-Zeilen und lässt die Trennzeilen weg", () => {
    const archiv = Buffer.from(
      "From a@example.com Tue Nov  3 08:12:04 2026\nSubject: Eins\n\nText eins\n\nFrom b@example.com Wed Nov  4 09:00:00 2026\nSubject: Zwei\n\nText zwei\n",
      "latin1",
    );
    const mails = mboxAufteilen(archiv).map(text);
    expect(mails).toEqual(["Subject: Eins\n\nText eins\n", "Subject: Zwei\n\nText zwei\n"]);
  });

  it("nimmt genau ein > vor maskierten From-Zeilen weg (mboxrd)", () => {
    const archiv = Buffer.from(
      "From a@x Tue Nov  3 08:12:04 2026\nSubject: Zitat\n\n>From damals\n>>From noch früher\n",
      "latin1",
    );
    expect(text(mboxAufteilen(archiv)[0]!)).toBe("Subject: Zitat\n\nFrom damals\n>From noch früher\n");
  });

  it("lässt Bytes außerhalb von ASCII unverändert", () => {
    const bytes = new Uint8Array([...Buffer.from("From a@x Tue Nov  3 08:12:04 2026\n\n"), 0xc3, 0xbc, 0xff, 0x0a]);
    expect([...mboxAufteilen(bytes)[0]!]).toEqual([0x0a, 0xc3, 0xbc, 0xff, 0x0a]);
  });

  it("findet in leeren oder fremden Dateien keine Mail", () => {
    expect(mboxAufteilen(new Uint8Array(0))).toEqual([]);
    expect(mboxAufteilen(Buffer.from("Subject: keine Trennzeile\n"))).toEqual([]);
  });
});
