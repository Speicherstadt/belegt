import { randomBytes } from "node:crypto";
import { sha256Of } from "@firsttris/gobd-kern/dateispeicher";
import { describe, expect, it } from "vitest";
import { readEnv } from "../env.ts";
import { speicherAusEnv } from "./auswahl.ts";
import { s3Entschluesseln, s3PfadHash, s3PruefenStream, s3SchluesselAus, s3Verschluesseln } from "./s3-krypto.ts";

const streamAus = (bytes: Uint8Array, stueckGroesse: number) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += stueckGroesse) c.enqueue(bytes.subarray(i, i + stueckGroesse));
      c.close();
    },
  });

describe("S3-Verschlüsselung (Envelope Encryption)", () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  it("liest einen oder mehrere 32-Byte-Schlüssel aus base64 und lehnt ungültige ab", () => {
    const ein = s3SchluesselAus(k1.toString("base64"));
    expect(ein).toHaveLength(1);
    expect(ein[0]!.equals(k1)).toBe(true);

    const zwei = s3SchluesselAus(` ${k2.toString("base64")} , ${k1.toString("base64")} `);
    expect(zwei).toHaveLength(2);
    expect(zwei[0]!.equals(k2)).toBe(true);
    expect(zwei[1]!.equals(k1)).toBe(true);

    expect(() => s3SchluesselAus("")).toThrow("S3_SCHLUESSEL");
    expect(() => s3SchluesselAus(randomBytes(16).toString("base64"))).toThrow("32 Bytes");
  });

  it("verschlüsselt und entschlüsselt mit eigenem Datenschlüssel je Aufruf, auch leer", () => {
    for (const klar of [Buffer.alloc(0), Buffer.from("Geheimer Arztbrief § 203 StGB"), randomBytes(200_000)]) {
      const a = s3Verschluesseln(k1, klar);
      const b = s3Verschluesseln(k1, klar);
      expect(a.equals(b)).toBe(false);
      if (klar.length > 0) expect(a.includes(klar)).toBe(false);
      expect(s3Entschluesseln([k1], a).equals(klar)).toBe(true);
    }
  });

  it("unterstützt Schlüsselrotation beim Entschlüsseln und meldet fehlenden Schlüssel klar", () => {
    const klar = Buffer.from("Altbestand unter Schlüssel 1");
    const versiegelt = s3Verschluesseln(k1, klar);
    expect(s3Entschluesseln([k2, k1], versiegelt).equals(klar)).toBe(true);
    expect(() => s3Entschluesseln([k2], versiegelt)).toThrow("Kein passender S3_SCHLUESSEL");
  });

  it("erkennt Änderungen an Kopf, Datenschlüssel, Chiffretext und Tag", () => {
    const versiegelt = s3Verschluesseln(k1, Buffer.from("Unveränderbar"));
    for (const pos of [0, 6, 15, 45, 90, versiegelt.length - 1]) {
      const kaputt = Buffer.from(versiegelt);
      kaputt[pos] = (kaputt[pos] ?? 0) ^ 0x01;
      expect(() => s3Entschluesseln([k1], kaputt)).toThrow();
    }
    expect(() => s3Entschluesseln([k1], versiegelt.subarray(0, 40))).toThrow("unvollständig");
  });

  it("prüft gestreamt über beliebige Stückgrößen (auch 1 Byte und 7 Bytes)", async () => {
    const klar = Buffer.from("Streaming-Prüfung über Kopf- und Tag-Grenzen hinweg");
    const sha = sha256Of(klar);
    const versiegelt = s3Verschluesseln(k1, klar);

    for (const groesse of [1, 7, 16, 85, 1024]) {
      expect(await s3PruefenStream([k2, k1], streamAus(versiegelt, groesse), sha)).toBe("ok");
    }
    // Falscher erwarteter Klartext-Hash (z. B. vertauschte Objekte)
    expect(await s3PruefenStream([k1], streamAus(versiegelt, 13), "0".repeat(64))).toBe("beschädigt");
    // Manipulierter Tag
    const kaputt = Buffer.from(versiegelt);
    kaputt[kaputt.length - 1] = (kaputt[kaputt.length - 1] ?? 0) ^ 0xff;
    expect(await s3PruefenStream([k1], streamAus(kaputt, 13), sha)).toBe("beschädigt");
    // Unbekannter Schlüssel wirft, statt als beschädigte Datei zu gelten
    await expect(s3PruefenStream([k2], streamAus(versiegelt, 13), sha)).rejects.toThrow("Kein passender S3_SCHLUESSEL");
  });

  it("hält den HMAC-Pfad stabil, wenn ein neuer Schlüssel vorangestellt wird", () => {
    const sha = sha256Of(Buffer.from("Dokument"));
    const pfadAlt = s3PfadHash([k1], sha);
    expect(pfadAlt).toMatch(/^[0-9a-f]{64}$/);
    expect(pfadAlt).not.toBe(sha);
    expect(s3PfadHash([k2, k1], sha)).toBe(pfadAlt);
  });

  it("reicht S3_SCHLUESSEL und S3_PFAD_HMAC über readEnv und speicherAusEnv durch", () => {
    const basis = {
      S3_ENDPUNKT: "https://s3.example.org",
      S3_BUCKET: "archiv",
      S3_ZUGANG_ID: "id",
      S3_ZUGANG_GEHEIMNIS: "geheim",
    };
    const sha = sha256Of(Buffer.from("Umgebungstest"));
    const { speicher } = speicherAusEnv(
      readEnv({ ...basis, S3_SCHLUESSEL: k1.toString("base64"), S3_PFAD_HMAC: "true" }),
    );
    const erwartet = s3PfadHash([k1], sha);
    expect(speicher.pfad(sha)).toBe(`s3://archiv/${erwartet.slice(0, 2)}/${erwartet}`);
    expect(() => speicherAusEnv(readEnv({ ...basis, S3_PFAD_HMAC: "true" }))).toThrow(
      "S3_PFAD_HMAC erfordert S3_SCHLUESSEL",
    );
  });
});
