/**
 * Das Nötigste an DER (ITU-T X.690) für Zeitstempel nach RFC 3161: Elemente bauen und lesen. Kein allgemeiner
 * ASN.1-Parser; er kennt nur, was eine Anfrage und die Antwort eines Zeitstempeldienstes brauchen.
 */

export interface Element {
  tag: number;
  /** Inhalt ohne Tag und Länge */
  inhalt: Uint8Array;
  /** Das ganze Element mit Tag und Länge */
  roh: Uint8Array;
}

function laengeKodieren(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function element(tag: number, ...teile: Uint8Array[]): Uint8Array {
  const inhalt = Buffer.concat(teile);
  return Buffer.concat([Uint8Array.of(tag), laengeKodieren(inhalt.length), inhalt]);
}

export const SEQUENCE = 0x30;
export const SET = 0x31;
export const INTEGER = 0x02;
export const OCTET_STRING = 0x04;
export const NULL = 0x05;
export const OID = 0x06;
export const BOOLEAN = 0x01;
export const GENERALIZED_TIME = 0x18;

/** Eine Objektkennung wie 2.16.840.1.101.3.4.2.1 */
export function oid(text: string): Uint8Array {
  const [a = 0, b = 0, ...rest] = text.split(".").map(Number);
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const teil: number[] = [];
    let x = n;
    do {
      teil.unshift((x & 0x7f) | (teil.length ? 0x80 : 0));
      x = Math.floor(x / 128);
    } while (x > 0);
    bytes.push(...teil);
  }
  return element(OID, Uint8Array.from(bytes));
}

/** Eine nicht negative ganze Zahl aus Bytes (führende Null, wenn das höchste Bit gesetzt ist) */
export function ganzzahl(bytes: Uint8Array): Uint8Array {
  let b = Buffer.from(bytes);
  while (b.length > 1 && b[0] === 0 && (b[1]! & 0x80) === 0) b = b.subarray(1);
  return element(INTEGER, (b[0]! & 0x80) !== 0 ? Buffer.concat([Uint8Array.of(0), b]) : b);
}

/** Liest ein Element ab `pos`; wirft bei abgeschnittenen Daten */
export function lesen(bytes: Uint8Array, pos = 0): Element & { ende: number } {
  if (pos + 2 > bytes.length) throw new Error("DER: zu kurz");
  const tag = bytes[pos]!;
  let laenge = bytes[pos + 1]!;
  let kopf = 2;
  if (laenge & 0x80) {
    const n = laenge & 0x7f;
    if (n === 0 || n > 4 || pos + 2 + n > bytes.length) throw new Error("DER: ungültige Länge");
    laenge = 0;
    for (let i = 0; i < n; i++) laenge = laenge * 256 + bytes[pos + 2 + i]!;
    kopf += n;
  }
  const ende = pos + kopf + laenge;
  if (ende > bytes.length) throw new Error("DER: abgeschnitten");
  return { tag, inhalt: bytes.subarray(pos + kopf, ende), roh: bytes.subarray(pos, ende), ende };
}

/** Die Elemente in einer SEQUENCE oder einem SET */
export function kinder(e: { inhalt: Uint8Array }): Element[] {
  const liste: Element[] = [];
  for (let pos = 0; pos < e.inhalt.length; ) {
    const k = lesen(e.inhalt, pos);
    liste.push(k);
    pos = k.ende;
  }
  return liste;
}

export function oidText(e: Element): string {
  const b = e.inhalt;
  const teile = [Math.floor(b[0]! / 40), b[0]! % 40];
  let n = 0;
  for (const x of b.subarray(1)) {
    n = n * 128 + (x & 0x7f);
    if (!(x & 0x80)) {
      teile.push(n);
      n = 0;
    }
  }
  return teile.join(".");
}
