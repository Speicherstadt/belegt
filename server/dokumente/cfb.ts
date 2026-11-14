/**
 * Namen der Einträge direkt unter der Wurzel einer Compound File ([MS-CFB] 2.2 Kopf, 2.3 FAT, 2.6 Verzeichnis).
 * Nur diese sagen, welche Anwendung die Datei schrieb; tiefer liegen eingebettete Objekte und Anhänge, etwa ein
 * Word-Dokument in einer Excel-Datei oder einer Outlook-Mail. Null, wenn die Datei kaputt ist.
 */

const KEIN = 0xffffffff;
const ENDE = 0xfffffffe;
const MAX_EINTRAEGE = 100_000;

export function cfbWurzelNamen(bytes: Uint8Array): string[] | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const shift = v.getUint16(0x1e, true);
    if (shift !== 9 && shift !== 12) return null;
    const groesse = 1 << shift;
    const proSektor = groesse / 4;
    const sektor = (n: number) => (n + 1) * groesse;
    const maxSektoren = Math.floor(bytes.length / groesse);

    // Wo die FAT liegt: 109 Einträge im Kopf, der Rest in einer Kette von DIFAT-Sektoren (2.5)
    const fatSektoren: number[] = [];
    for (let i = 0; i < 109; i++) fatSektoren.push(v.getUint32(0x4c + 4 * i, true));
    for (let n = v.getUint32(0x44, true), i = 0; n < ENDE && i < maxSektoren; i++) {
      for (let j = 0; j < proSektor - 1; j++) fatSektoren.push(v.getUint32(sektor(n) + 4 * j, true));
      n = v.getUint32(sektor(n) + groesse - 4, true);
    }
    const naechster = (n: number) => {
      const fs = fatSektoren[Math.floor(n / proSektor)];
      if (fs === undefined || fs >= ENDE) return ENDE;
      return v.getUint32(sektor(fs) + 4 * (n % proSektor), true);
    };

    const eintraege: { name: string; links: number; rechts: number; kind: number }[] = [];
    for (let n = v.getUint32(0x30, true), i = 0; n < ENDE && i < maxSektoren; n = naechster(n), i++) {
      for (let j = 0; j < groesse / 128 && eintraege.length < MAX_EINTRAEGE; j++) {
        const o = sektor(n) + 128 * j;
        const laenge = Math.min(v.getUint16(o + 0x40, true), 64);
        eintraege.push({
          name: Buffer.from(bytes.subarray(o, o + Math.max(laenge - 2, 0))).toString("utf16le"),
          links: v.getUint32(o + 0x44, true),
          rechts: v.getUint32(o + 0x48, true),
          kind: v.getUint32(o + 0x4c, true),
        });
      }
    }

    // Die Kinder eines Storages bilden einen Baum über links und rechts (2.6.4)
    const namen: string[] = [];
    const gesehen = new Set<number>();
    const offen = [eintraege[0]?.kind ?? KEIN];
    while (offen.length) {
      const i = offen.pop()!;
      const e = eintraege[i];
      if (!e || gesehen.has(i)) continue;
      gesehen.add(i);
      namen.push(e.name);
      offen.push(e.links, e.rechts);
    }
    return namen;
  } catch {
    // RangeError: ein Zeiger zeigt hinter das Ende der Datei
    return null;
  }
}
