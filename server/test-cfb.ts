/**
 * Baut eine kleine, gültige Compound File (MS-CFB, Version 3, Sektoren zu 512 Bytes) für Tests: Kopf, ein Sektor FAT,
 * das Verzeichnis und am Ende optional Daten eines Streams. Geschwister hängen als Kette am rechten Zeiger.
 */
export interface CfbEintrag {
  name: string;
  /** 1 Storage, 2 Stream */
  typ: 1 | 2;
  kinder?: CfbEintrag[];
  /** Inhalt des Streams; landet in eigenen Sektoren hinter dem Verzeichnis */
  daten?: Uint8Array;
}

const KEIN = 0xffffffff;
const ENDE = 0xfffffffe;
const FAT_SEKTOR = 0xfffffffd;

export function cfbDatei(wurzel: CfbEintrag[]): Uint8Array {
  const flach: { e: CfbEintrag | null; kind: number; rechts: number }[] = [{ e: null, kind: KEIN, rechts: KEIN }];
  const anhaengen = (kinder: CfbEintrag[], eltern: number) => {
    let vorher = -1;
    for (const k of kinder) {
      const i = flach.length;
      flach.push({ e: k, kind: KEIN, rechts: KEIN });
      if (vorher < 0) flach[eltern]!.kind = i;
      else flach[vorher]!.rechts = i;
      vorher = i;
      if (k.kinder) anhaengen(k.kinder, i);
    }
  };
  anhaengen(wurzel, 0);

  const verzeichnisSektoren = Math.ceil(flach.length / 4);
  const daten = flach.map((f) => f.e?.daten ?? new Uint8Array(0));
  const datenSektoren = daten.map((d) => Math.ceil(d.length / 512));
  const sektoren = 1 + verzeichnisSektoren + datenSektoren.reduce((a, b) => a + b, 0);
  if (sektoren > 128) throw new Error("Test-CFB zu groß");
  const b = new Uint8Array(512 * (1 + sektoren));
  const v = new DataView(b.buffer);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  v.setUint16(0x18, 0x3e, true);
  v.setUint16(0x1a, 3, true);
  v.setUint16(0x1c, 0xfffe, true);
  v.setUint16(0x1e, 9, true);
  v.setUint16(0x20, 6, true);
  v.setUint32(0x2c, 1, true);
  v.setUint32(0x30, 1, true);
  v.setUint32(0x38, 4096, true);
  v.setUint32(0x3c, ENDE, true);
  v.setUint32(0x44, ENDE, true);
  for (let i = 0; i < 109; i++) v.setUint32(0x4c + 4 * i, i === 0 ? 0 : KEIN, true);

  const sektor = (n: number) => 512 * (n + 1);
  const fat = (n: number, wert: number) => v.setUint32(sektor(0) + 4 * n, wert, true);
  for (let n = 0; n < 128; n++) fat(n, KEIN);
  fat(0, FAT_SEKTOR);
  for (let n = 1; n <= verzeichnisSektoren; n++) fat(n, n === verzeichnisSektoren ? ENDE : n + 1);

  let frei = 1 + verzeichnisSektoren;
  flach.forEach((f, i) => {
    const o = sektor(1 + Math.floor(i / 4)) + 128 * (i % 4);
    const name = f.e?.name ?? "Root Entry";
    b.set(Buffer.from(`${name}\0`, "utf16le"), o);
    v.setUint16(o + 0x40, (name.length + 1) * 2, true);
    b[o + 0x42] = f.e?.typ ?? 5;
    b[o + 0x43] = 1;
    v.setUint32(o + 0x44, KEIN, true);
    v.setUint32(o + 0x48, f.rechts, true);
    v.setUint32(o + 0x4c, f.kind, true);
    v.setUint32(o + 0x74, ENDE, true);
    const d = daten[i]!;
    if (d.length) {
      v.setUint32(o + 0x74, frei, true);
      v.setUint32(o + 0x78, d.length, true);
      b.set(d, sektor(frei));
      for (let s = 0; s < datenSektoren[i]!; s++) fat(frei + s, s === datenSektoren[i]! - 1 ? ENDE : frei + s + 1);
      frei += datenSektoren[i]!;
    }
  });
  // Leere Einträge im letzten Verzeichnissektor
  for (let i = flach.length; i < verzeichnisSektoren * 4; i++) {
    const o = sektor(1 + Math.floor(i / 4)) + 128 * (i % 4);
    for (const off of [0x44, 0x48, 0x4c]) v.setUint32(o + off, KEIN, true);
  }
  return b;
}
