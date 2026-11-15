/*
 * Breite und Höhe eines Bildes aus seinem Kopf, ohne es zu entpacken: Vor der Texterkennung wird so ein riesiges Bild
 * (wenige KB, Milliarden Bildpunkte) abgelehnt, statt dass Tesseract es ganz in den Speicher lädt. Formate: PNG
 * (IHDR, ISO/IEC 15948 11.2.2), JPEG (SOFn, ITU T.81 B.2.2) und WebP (VP8, VP8L, VP8X; RFC 9649).
 */

export interface Masse {
  breite: number;
  hoehe: number;
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const text = (b: Uint8Array, von: number, bis: number) => String.fromCharCode(...b.subarray(von, bis));

function png(b: Uint8Array): Masse | null {
  if (b.length < 24 || text(b, 12, 16) !== "IHDR") return null;
  return { breite: be32(b, 16), hoehe: be32(b, 20) };
}

function jpeg(b: Uint8Array): Masse | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    // Füllbytes und Marker ohne Länge (RSTn, TEM)
    if (marker === 0xff) {
      i++;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    // SOF0 bis SOF15 außer DHT (C4), JPG (C8) und DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { hoehe: be16(b, i + 5), breite: be16(b, i + 7) };
    i += 2 + be16(b, i + 2);
  }
  return null;
}

function webp(b: Uint8Array): Masse | null {
  if (b.length < 30) return null;
  const art = text(b, 12, 16);
  if (art === "VP8 ") return { breite: le16(b, 26) & 0x3fff, hoehe: le16(b, 28) & 0x3fff };
  if (art === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { breite: (bits & 0x3fff) + 1, hoehe: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (art === "VP8X") return { breite: le24(b, 24) + 1, hoehe: le24(b, 27) + 1 };
  return null;
}

/** Maße eines PNG, JPEG oder WebP; null, wenn der Kopf fehlt oder das Format ein anderes ist */
export function bildMasse(b: Uint8Array): Masse | null {
  if (b[0] === 0x89 && text(b, 1, 4) === "PNG") return png(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (text(b, 0, 4) === "RIFF" && text(b, 8, 12) === "WEBP") return webp(b);
  return null;
}
