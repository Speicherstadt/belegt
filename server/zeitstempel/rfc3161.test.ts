import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anfrage, antwortLesen, zeitstempelHolen } from "./rfc3161.ts";
import { opensslDa, testTsa } from "./tsa-test.ts";

describe.skipIf(!opensslDa)("Zeitstempel nach RFC 3161 (gegen OpenSSL als Dienst)", () => {
  let tsa: Awaited<ReturnType<typeof testTsa>>;
  beforeAll(async () => {
    tsa = await testTsa();
  });
  afterAll(() => tsa?.schliessen());

  it("holt ein Token, das zum Hash passt und das openssl unabhängig bestätigt", async () => {
    const hash = createHash("sha256").update("Kopf der Kette").digest();
    const z = await zeitstempelHolen(tsa.url, hash);
    expect(Math.abs(z.zeit.getTime() - Date.now())).toBeLessThan(60_000);
    expect(z.seriennummer).toMatch(/^[0-9a-f]+$/);
    expect(tsa.pruefen(z.token, hash.toString("hex"))).toBe(true);
    expect(tsa.pruefen(z.token, createHash("sha256").update("etwas anderes").digest("hex"))).toBe(false);
  });

  it("lehnt eine Antwort für einen anderen Hash oder eine andere Nonce ab", async () => {
    const hash = randomBytes(32);
    const nonce = randomBytes(8);
    const res = await fetch(tsa.url, { method: "POST", body: new Uint8Array(anfrage(hash, nonce)) });
    const antwort = new Uint8Array(await res.arrayBuffer());
    expect(antwortLesen(antwort, hash, nonce).token.length).toBeGreaterThan(100);
    expect(() => antwortLesen(antwort, randomBytes(32), nonce)).toThrow("gilt nicht für diesen Hash");
    expect(() => antwortLesen(antwort, hash, randomBytes(8))).toThrow("Nonce passt nicht");
    expect(() => antwortLesen(antwort.subarray(0, 40), hash, nonce)).toThrow();
  });

  it("meldet einen Fehler des Dienstes", async () => {
    tsa.zustand.ablehnen = true;
    await expect(zeitstempelHolen(tsa.url, randomBytes(32))).rejects.toThrow("Zeitstempel: Antwort 503");
    tsa.zustand.ablehnen = false;
  });
});
