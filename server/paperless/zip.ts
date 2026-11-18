import { type FileHandle, open } from "node:fs/promises";
import { Inflate } from "fflate";

/*
 * ZIP lesen, ohne es ganz in den Speicher zu laden: das zentrale Verzeichnis am Ende (APPNOTE.TXT 4.3.12 ff., mit
 * ZIP64 nach 4.3.14 und 4.5.3), dann je Eintrag nur seine Bytes. Ein Export von Paperless-ngx schreibt Python mit
 * zipfile, ohne Angabe DEFLATE (src/documents/management/commands/document_exporter.py, --zip-compression); andere
 * Verfahren und verschlüsselte Einträge lehnt Belegt ab. Gegen ZIP-Bomben (Muster wie server/dokumente/office.ts): Jeder
 * Eintrag hat eine Obergrenze, entpackt wird höchstens so viel, wie das Verzeichnis angibt, und mehr bricht ab.
 */

export interface ZipEintrag {
  name: string;
  methode: number;
  komprimiert: number;
  groesse: number;
  /** Lage des lokalen Kopfs */
  versatz: number;
  verschluesselt: boolean;
}

export interface Zip {
  eintraege: Map<string, ZipEintrag>;
  /** Die entpackten Bytes eines Eintrags; wirft bei mehr als hoechstens Bytes oder mehr als angegeben */
  lesen(name: string, hoechstens: number): Promise<Uint8Array>;
  schliessen(): Promise<void>;
}

/** Mehr Einträge hat kein Export, den Belegt annimmt (Original, Vorschaubild, Archivversion und Manifest je Dokument) */
const MAX_EINTRAEGE = 4_000_000;

const u16 = (b: Buffer, i: number) => b.readUInt16LE(i);
const u32 = (b: Buffer, i: number) => b.readUInt32LE(i);
const u64 = (b: Buffer, i: number) => {
  const n = b.readBigUInt64LE(i);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ZIP: Angabe zu groß");
  return Number(n);
};

async function lesenAb(h: FileHandle, versatz: number, laenge: number): Promise<Buffer> {
  const b = Buffer.alloc(laenge);
  const { bytesRead } = await h.read(b, 0, laenge, versatz);
  if (bytesRead !== laenge) throw new Error("ZIP: Datei endet vorzeitig");
  return b;
}

/** Ende des zentralen Verzeichnisses: Lage, Größe und Zahl der Einträge, mit ZIP64 */
async function verzeichnisEnde(h: FileHandle, dateigroesse: number) {
  // Das Ende ist 22 Bytes lang, dazu ein Kommentar bis 65535 Bytes
  const laenge = Math.min(dateigroesse, 22 + 65535);
  const ende = await lesenAb(h, dateigroesse - laenge, laenge);
  let i = ende.length - 22;
  while (i >= 0 && u32(ende, i) !== 0x06054b50) i--;
  if (i < 0) throw new Error("Kein ZIP-Archiv");
  let anzahl = u16(ende, i + 10);
  let groesse = u32(ende, i + 12);
  let versatz = u32(ende, i + 16);
  const lage = dateigroesse - laenge + i;
  // ZIP64: Locator 20 Bytes vor dem Ende, er zeigt auf das ZIP64-Ende
  if (lage >= 20) {
    const locator = await lesenAb(h, lage - 20, 20);
    if (u32(locator, 0) === 0x07064b50) {
      const z64 = await lesenAb(h, u64(locator, 8), 56);
      if (u32(z64, 0) !== 0x06064b50) throw new Error("ZIP: ZIP64-Ende fehlt");
      anzahl = u64(z64, 32);
      groesse = u64(z64, 40);
      versatz = u64(z64, 48);
    }
  }
  if (versatz + groesse > dateigroesse) throw new Error("ZIP: Verzeichnis liegt außerhalb der Datei");
  // Jeder Eintrag im Verzeichnis braucht mindestens 46 Bytes: mehr kann die Datei nicht enthalten
  if (anzahl > MAX_EINTRAEGE || anzahl * 46 > groesse) throw new Error("ZIP: zu viele Einträge");
  return { anzahl, groesse, versatz };
}

/** ZIP64-Zusatzfeld (ID 1): ersetzt die Angaben, die im Verzeichnis 0xFFFFFFFF sind, in dieser Reihenfolge */
function zip64(extra: Buffer, e: { groesse: number; komprimiert: number; versatz: number }) {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = u16(extra, i);
    const laenge = u16(extra, i + 2);
    if (id === 1) {
      let j = i + 4;
      if (e.groesse === 0xffffffff) {
        e.groesse = u64(extra, j);
        j += 8;
      }
      if (e.komprimiert === 0xffffffff) {
        e.komprimiert = u64(extra, j);
        j += 8;
      }
      if (e.versatz === 0xffffffff) e.versatz = u64(extra, j);
      return;
    }
    i += 4 + laenge;
  }
}

function verzeichnisLesen(b: Buffer, anzahl: number): Map<string, ZipEintrag> {
  const eintraege = new Map<string, ZipEintrag>();
  let i = 0;
  for (let n = 0; n < anzahl; n++) {
    if (i + 46 > b.length || u32(b, i) !== 0x02014b50) throw new Error("ZIP: Verzeichnis beschädigt");
    const flags = u16(b, i + 8);
    const namenslaenge = u16(b, i + 28);
    const extralaenge = u16(b, i + 30);
    const kommentarlaenge = u16(b, i + 32);
    // Bit 11: Name in UTF-8; sonst CP437, für die Namen eines Exports (ASCII und UTF-8) genügt latin1 als Rückfall
    const name = b.toString(flags & 0x800 ? "utf8" : "latin1", i + 46, i + 46 + namenslaenge);
    const e: ZipEintrag = {
      name,
      methode: u16(b, i + 10),
      komprimiert: u32(b, i + 20),
      groesse: u32(b, i + 24),
      versatz: u32(b, i + 42),
      verschluesselt: (flags & 1) === 1,
    };
    zip64(b.subarray(i + 46 + namenslaenge, i + 46 + namenslaenge + extralaenge), e);
    if (!name.endsWith("/")) eintraege.set(name, e);
    i += 46 + namenslaenge + extralaenge + kommentarlaenge;
  }
  return eintraege;
}

/** Entpackt DEFLATE in Stücken und bricht ab, sobald mehr herauskommt als erlaubt */
function entpacken(daten: Uint8Array, erwartet: number): Uint8Array {
  const teile: Uint8Array[] = [];
  let laenge = 0;
  const inflate = new Inflate((teil) => {
    laenge += teil.length;
    if (laenge > erwartet) throw new Error("ZIP-Eintrag größer als angegeben (ZIP-Bombe?)");
    teile.push(teil);
  });
  const STUECK = 64 * 1024;
  for (let i = 0; i < daten.length; i += STUECK) {
    inflate.push(daten.subarray(i, i + STUECK), i + STUECK >= daten.length);
  }
  if (laenge !== erwartet) throw new Error("ZIP-Eintrag unvollständig");
  const ergebnis = new Uint8Array(laenge);
  let pos = 0;
  for (const t of teile) {
    ergebnis.set(t, pos);
    pos += t.length;
  }
  return ergebnis;
}

/** Öffnet ein ZIP auf der Platte und liest sein Verzeichnis */
export async function zipOeffnen(pfad: string): Promise<Zip> {
  const h = await open(pfad, "r");
  try {
    const { size } = await h.stat();
    const ende = await verzeichnisEnde(h, size);
    const eintraege = verzeichnisLesen(await lesenAb(h, ende.versatz, ende.groesse), ende.anzahl);
    return {
      eintraege,
      async lesen(name, hoechstens) {
        const e = eintraege.get(name);
        if (!e) throw new Error(`Datei fehlt im Export: ${name}`);
        if (e.verschluesselt) throw new Error(`Verschlüsselt: ${name}`);
        // DEFLATE wird nie viel größer als sein Inhalt; ein größerer Eintrag ist kaputt oder präpariert
        if (e.groesse > hoechstens || e.komprimiert > hoechstens + 1024 * 1024)
          throw new Error(`Zu groß (${e.groesse} Bytes): ${name}`);
        if (e.methode !== 0 && e.methode !== 8)
          throw new Error(
            `Kompression ${e.methode} nicht unterstützt (Export mit --zip-compression deflated): ${name}`,
          );
        const kopf = await lesenAb(h, e.versatz, 30);
        if (u32(kopf, 0) !== 0x04034b50) throw new Error(`ZIP: lokaler Kopf fehlt: ${name}`);
        const start = e.versatz + 30 + u16(kopf, 26) + u16(kopf, 28);
        if (start + e.komprimiert > size) throw new Error(`ZIP: Eintrag liegt außerhalb der Datei: ${name}`);
        const daten = await lesenAb(h, start, e.komprimiert);
        if (e.methode === 0) {
          if (e.komprimiert !== e.groesse) throw new Error(`ZIP: Größen passen nicht: ${name}`);
          return new Uint8Array(daten);
        }
        return entpacken(daten, e.groesse);
      },
      schliessen: () => h.close(),
    };
  } catch (err) {
    await h.close();
    throw err;
  }
}
