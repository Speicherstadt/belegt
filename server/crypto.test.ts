import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entschluesseln, schluesselAus, verschluesseln } from "./crypto.ts";

const schluessel = randomBytes(32);

describe("Verschlüsselung", () => {
  it("entschlüsselt, was sie verschlüsselt hat, mit neuem IV bei jedem Aufruf", () => {
    const a = verschluesseln(schluessel, Buffer.from("geheim"));
    const b = verschluesseln(schluessel, Buffer.from("geheim"));
    expect(a.equals(b)).toBe(false);
    expect(entschluesseln(schluessel, a).toString()).toBe("geheim");
    expect(a.includes(Buffer.from("geheim"))).toBe(false);
  });

  it("lehnt veränderte, gekürzte und mit anderem Schlüssel verschlüsselte Werte ab", () => {
    const v = verschluesseln(schluessel, Buffer.from("geheim"));
    const verfaelscht = Buffer.from(v);
    verfaelscht[verfaelscht.length - 1]! ^= 1;
    expect(() => entschluesseln(schluessel, verfaelscht)).toThrow();
    expect(() => entschluesseln(schluessel, v.subarray(0, 20))).toThrow(/unvollständig/);
    expect(() => entschluesseln(randomBytes(32), v)).toThrow();
  });

  it("verlangt einen Schlüssel von 32 Bytes", () => {
    expect(() => schluesselAus(Buffer.alloc(16).toString("base64"))).toThrow(/32 Bytes/);
    expect(schluesselAus(Buffer.alloc(32).toString("base64"))).toHaveLength(32);
  });
});
