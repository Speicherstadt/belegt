/*
 * Ein sRGB-Farbprofil (ICC v2, Monitor, RGB → XYZ) für den OutputIntent der Archivfassung (PDF/A-2, ISO 19005-2
 * 6.2.3). Belegt schreibt es selbst, statt eine fremde Profildatei mitzuliefern: Primärfarben und Kennlinie stehen in
 * IEC 61966-2-1 (sRGB), die Farborte der Primärfarben auf D50 angepasst (Bradford) wie im Profil des ICC
 * (https://www.color.org/srgbprofiles.xalter); der Aufbau folgt ICC.1:2001-04 (Kopf, Tag-Tabelle, desc, cprt, wtpt,
 * rXYZ/gXYZ/bXYZ, rTRC/gTRC/bTRC).
 */

const D50 = [0.9642, 1.0, 0.8249];
const ROT = [0.43607, 0.22249, 0.01392];
const GRUEN = [0.38515, 0.71687, 0.09708];
const BLAU = [0.14307, 0.06061, 0.7141];

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
/** s15Fixed16Number */
const fest = (x: number) => u32(Math.round(x * 65536) >>> 0);
const xyz = (w: number[]) => [...ascii("XYZ "), 0, 0, 0, 0, ...w.flatMap(fest)];

/** Kennlinie von sRGB (Gerätewert → linear) als Tabelle mit 1024 Stützstellen */
function kennlinie(): number[] {
  const n = 1024;
  const werte: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = i / (n - 1);
    const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    werte.push(...u16(Math.round(linear * 65535)));
  }
  return [...ascii("curv"), 0, 0, 0, 0, ...u32(n), ...werte];
}

/** textDescriptionType: ASCII, dazu leere Unicode- und ScriptCode-Fassung */
function beschreibung(text: string): number[] {
  return [
    ...ascii("desc"),
    ...[0, 0, 0, 0],
    ...u32(text.length + 1),
    ...ascii(text),
    0,
    ...u32(0),
    ...u32(0),
    ...u16(0),
    0,
    ...new Array<number>(67).fill(0),
  ];
}

const textTag = (text: string) => [...ascii("text"), 0, 0, 0, 0, ...ascii(text), 0];

let profil: Uint8Array | undefined;

/** Das Profil als Bytes; einmal erzeugt */
export function srgbProfil(): Uint8Array {
  if (profil) return profil;
  const trc = kennlinie();
  const tags: [string, number[]][] = [
    ["desc", beschreibung("sRGB IEC61966-2.1")],
    ["cprt", textTag("No copyright, use freely")],
    ["wtpt", xyz(D50)],
    ["rXYZ", xyz(ROT)],
    ["gXYZ", xyz(GRUEN)],
    ["bXYZ", xyz(BLAU)],
    ["rTRC", trc],
  ];
  // Die drei Kennlinien sind gleich; gTRC und bTRC zeigen auf dieselben Daten wie rTRC (ICC.1, 6.1: erlaubt)
  const tabelle: number[] = [];
  const daten: number[] = [];
  const anfang = 128 + 4 + (tags.length + 2) * 12;
  const lage: Record<string, [number, number]> = {};
  for (const [name, inhalt] of tags) {
    lage[name] = [anfang + daten.length, inhalt.length];
    daten.push(...inhalt);
    while (daten.length % 4) daten.push(0);
  }
  for (const name of ["desc", "cprt", "wtpt", "rXYZ", "gXYZ", "bXYZ", "rTRC", "gTRC", "bTRC"]) {
    const [versatz, laenge] = lage[name === "gTRC" || name === "bTRC" ? "rTRC" : name]!;
    tabelle.push(...ascii(name), ...u32(versatz), ...u32(laenge));
  }
  const groesse = anfang + daten.length;
  const kopf = [
    ...u32(groesse),
    ...u32(0),
    ...[0x02, 0x10, 0, 0],
    ...ascii("mntr"),
    ...ascii("RGB "),
    ...ascii("XYZ "),
    // Datum: 2026-01-01 00:00:00
    ...u16(2026),
    ...u16(1),
    ...u16(1),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...ascii("acsp"),
    ...new Array<number>(4 * 4 + 8 + 4).fill(0),
    ...D50.flatMap(fest),
    ...new Array<number>(48).fill(0),
  ];
  profil = new Uint8Array([...kopf, ...u32(tags.length + 2), ...tabelle, ...daten]);
  return profil;
}
