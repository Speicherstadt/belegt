import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipOeffnen } from "./zip.ts";

let ordner: string;
beforeAll(async () => {
  ordner = await mkdtemp(join(tmpdir(), "belegt-zip-"));
});
afterAll(() => rm(ordner, { recursive: true, force: true }));

const ablegen = async (name: string, bytes: Uint8Array) => {
  const pfad = join(ordner, name);
  await writeFile(pfad, bytes);
  return pfad;
};

/** Lage des Eintrags im zentralen Verzeichnis (Signatur PK\1\2) mit diesem Namen */
function verzeichnisEintrag(zip: Uint8Array, name: string): number {
  const b = Buffer.from(zip);
  for (let i = 0; i < b.length - 46; i++) {
    if (b.readUInt32LE(i) === 0x02014b50 && b.toString("utf8", i + 46, i + 46 + b.readUInt16LE(i + 28)) === name)
      return i;
  }
  throw new Error("nicht gefunden");
}

/** Ein kleines ZIP64 von Hand (APPNOTE 4.3.14, 4.5.3): ein gespeicherter Eintrag, Größen nur im Zusatzfeld */
function zip64(name: string, inhalt: Buffer): Buffer {
  const n = Buffer.from(name);
  const lokal = Buffer.alloc(30);
  lokal.writeUInt32LE(0x04034b50, 0);
  lokal.writeUInt16LE(45, 4);
  lokal.writeUInt32LE(crc32(inhalt), 14);
  lokal.writeUInt32LE(inhalt.length, 18);
  lokal.writeUInt32LE(inhalt.length, 22);
  lokal.writeUInt16LE(n.length, 26);
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(inhalt.length), 4);
  extra.writeBigUInt64LE(BigInt(inhalt.length), 12);
  extra.writeBigUInt64LE(0n, 20);
  const zentral = Buffer.alloc(46);
  zentral.writeUInt32LE(0x02014b50, 0);
  zentral.writeUInt16LE(45, 4);
  zentral.writeUInt16LE(45, 6);
  zentral.writeUInt32LE(crc32(inhalt), 16);
  zentral.writeUInt32LE(0xffffffff, 20);
  zentral.writeUInt32LE(0xffffffff, 24);
  zentral.writeUInt16LE(n.length, 28);
  zentral.writeUInt16LE(extra.length, 30);
  zentral.writeUInt32LE(0xffffffff, 42);
  const daten = Buffer.concat([lokal, n, inhalt]);
  const verzeichnis = Buffer.concat([zentral, n, extra]);
  const ende64 = Buffer.alloc(56);
  ende64.writeUInt32LE(0x06064b50, 0);
  ende64.writeBigUInt64LE(44n, 4);
  ende64.writeBigUInt64LE(1n, 24);
  ende64.writeBigUInt64LE(1n, 32);
  ende64.writeBigUInt64LE(BigInt(verzeichnis.length), 40);
  ende64.writeBigUInt64LE(BigInt(daten.length), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(daten.length + verzeichnis.length), 8);
  locator.writeUInt32LE(1, 16);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(0xffff, 8);
  ende.writeUInt16LE(0xffff, 10);
  ende.writeUInt32LE(0xffffffff, 12);
  ende.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([daten, verzeichnis, ende64, locator, ende]);
}

describe("ZIP", () => {
  it("liest gespeicherte und komprimierte Einträge einzeln", async () => {
    const zip = zipSync({
      "manifest.json": new TextEncoder().encode("[]"),
      "originals/a.pdf": [new TextEncoder().encode("%PDF-1.7 a".repeat(100)), { level: 9 }],
      "originals/b.txt": [new TextEncoder().encode("b"), { level: 0 }],
    });
    const z = await zipOeffnen(await ablegen("ok.zip", zip));
    try {
      expect([...z.eintraege.keys()].sort()).toEqual(["manifest.json", "originals/a.pdf", "originals/b.txt"]);
      expect(new TextDecoder().decode(await z.lesen("originals/a.pdf", 10_000))).toBe("%PDF-1.7 a".repeat(100));
      expect(new TextDecoder().decode(await z.lesen("originals/b.txt", 10))).toBe("b");
      await expect(z.lesen("fehlt.pdf", 10)).rejects.toThrow("fehlt im Export");
    } finally {
      await z.schliessen();
    }
  });

  it("bricht eine ZIP-Bombe ab: mehr als angegeben wird nie entpackt", async () => {
    // 50 MB Nullen werden zu wenigen KB; im Verzeichnis steht als Größe 1 KB
    const zip = zipSync({ "originals/bombe.pdf": [new Uint8Array(50 * 1024 * 1024), { level: 9 }] });
    expect(zip.length).toBeLessThan(200 * 1024);
    Buffer.from(zip.buffer).writeUInt32LE(1024, verzeichnisEintrag(zip, "originals/bombe.pdf") + 24);
    const z = await zipOeffnen(await ablegen("bombe.zip", zip));
    try {
      await expect(z.lesen("originals/bombe.pdf", 100 * 1024 * 1024)).rejects.toThrow("größer als angegeben");
    } finally {
      await z.schliessen();
    }
  });

  it("lehnt Einträge über der Grenze ab, ohne sie zu entpacken", async () => {
    const zip = zipSync({ "gross.pdf": [new Uint8Array(2 * 1024 * 1024), { level: 9 }] });
    const z = await zipOeffnen(await ablegen("gross.zip", zip));
    try {
      await expect(z.lesen("gross.pdf", 1024 * 1024)).rejects.toThrow("Zu groß");
    } finally {
      await z.schliessen();
    }
  });

  it("lehnt andere Kompression, Verschlüsselung und Dateien ohne ZIP ab", async () => {
    const zip = zipSync({
      "a.pdf": [new TextEncoder().encode("a"), { level: 0 }],
      "b.pdf": new TextEncoder().encode("b"),
    });
    const b = Buffer.from(zip.buffer);
    b.writeUInt16LE(12, verzeichnisEintrag(zip, "a.pdf") + 10); // bzip2
    b.writeUInt16LE(1, verzeichnisEintrag(zip, "b.pdf") + 8); // verschlüsselt
    const z = await zipOeffnen(await ablegen("anders.zip", zip));
    try {
      await expect(z.lesen("a.pdf", 10)).rejects.toThrow("Kompression 12 nicht unterstützt");
      await expect(z.lesen("b.pdf", 10)).rejects.toThrow("Verschlüsselt");
    } finally {
      await z.schliessen();
    }
    await expect(zipOeffnen(await ablegen("kein.zip", new TextEncoder().encode("kein zip")))).rejects.toThrow(
      "Kein ZIP-Archiv",
    );
  });

  it("lehnt ein Verzeichnis ab, das mehr Einträge behauptet, als in der Datei Platz haben", async () => {
    const zip = zipSync({ "a.pdf": new TextEncoder().encode("a") });
    const b = Buffer.from(zip.buffer);
    b.writeUInt16LE(60_000, b.length - 22 + 10);
    await expect(zipOeffnen(await ablegen("viele.zip", zip))).rejects.toThrow("zu viele Einträge");
  });

  it("liest ZIP64", async () => {
    const z = await zipOeffnen(await ablegen("z64.zip", zip64("originals/x.pdf", Buffer.from("%PDF ZIP64"))));
    try {
      expect(z.eintraege.get("originals/x.pdf")).toMatchObject({ groesse: 10, komprimiert: 10, versatz: 0 });
      expect(new TextDecoder().decode(await z.lesen("originals/x.pdf", 100))).toBe("%PDF ZIP64");
    } finally {
      await z.schliessen();
    }
  });
});
