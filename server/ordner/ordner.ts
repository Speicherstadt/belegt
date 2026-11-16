import { constants, type Dirent } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { aufnehmenEinmal } from "../dokumente/doppelt.ts";

/*
 * Überwachter Eingangsordner (etwa das Ziel eines Scanners): Der Worker schaut alle paar Sekunden hinein, nimmt jede
 * fertig geschriebene Datei mit aufnehmen auf und entfernt sie erst danach. Was sich nicht aufnehmen lässt, verschiebt
 * er nach <ordner>/fehler/; gelöscht wird dort nichts, was nicht im Archiv liegt.
 */

/** Unterordner für Dateien, die sich nicht aufnehmen ließen */
export const FEHLER = "fehler";
/** Größte Datei, wie beim Upload */
export const MAX_DATEI = 100 * 1024 * 1024;
export const AKTEUR = "system:ordner";

/**
 * Akteur im Audit-Log: system:ordner, für eine Datei in einem Unterordner mit dessen Pfad (system:ordner:Steuer/2026).
 * Daran erkennen Workflows den Unterordner (server/workflows/), auch ohne EINGANG_ORDNER_TAGS.
 */
export const akteurFuer = (rel: string) => {
  const teile = unterordner(rel);
  return teile.length ? `${AKTEUR}:${teile.join("/")}` : AKTEUR;
};
/** So lange muss eine leere Datei unverändert liegen, bevor sie nach fehler/ kommt: Mancher Scanner legt sie erst an */
export const LEER_WARTEN_MS = 10 * 60_000;

/** Größe und Änderungszeit beim letzten Blick, je Pfad relativ zum Ordner */
export type Zustand = Map<string, { groesse: number; mtimeMs: number }>;

/**
 * Pfade, die schon beim letzten Blick mit derselben Größe und Änderungszeit da waren. Was gerade erst auftaucht oder
 * noch wächst, schreibt der Scanner vielleicht noch; es kommt frühestens beim nächsten Blick dran.
 */
export function stabile(vorher: Zustand, jetzt: Zustand): string[] {
  return [...jetzt]
    .filter(([pfad, s]) => {
      const v = vorher.get(pfad);
      return v !== undefined && v.groesse === s.groesse && v.mtimeMs === s.mtimeMs;
    })
    .map(([pfad]) => pfad);
}

/** Versteckte und temporäre Dateien: Punkt am Anfang, Office-Sperrdateien, halbe Downloads und Kopien */
export function ignoriert(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~$") ||
    name.endsWith("~") ||
    /\.(tmp|temp|part|partial|crdownload|download|swp)$/i.test(name)
  );
}

const meldung = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 300);
const anzeige = (rel: string) => rel.split(sep).join("/");

/** Ein Unterordner, der sich nicht lesen ließ (etwa fehlende Rechte); der Rest des Blicks läuft weiter */
export interface Uebersprungen {
  ordner: string;
  meldung: string;
}

/**
 * Alle Dateien unter dem Ordner, rekursiv, ohne fehler/, versteckte Ordner und Symlinks (die könnten hinausführen).
 * Lässt sich ein Unterordner nicht lesen, steht er in uebersprungen; scheitert der Eingangsordner selbst, wirft es.
 */
export async function auflisten(
  wurzel: string,
  lesenOrdner: typeof readdir = readdir,
): Promise<{ zustand: Zustand; uebersprungen: Uebersprungen[] }> {
  const zustand: Zustand = new Map();
  const uebersprungen: Uebersprungen[] = [];
  async function lesen(ordner: string) {
    let eintraege: Dirent[];
    try {
      eintraege = await lesenOrdner(ordner, { withFileTypes: true });
    } catch (err) {
      if (ordner === wurzel) throw err;
      uebersprungen.push({ ordner: anzeige(relative(wurzel, ordner)), meldung: meldung(err) });
      return;
    }
    for (const eintrag of eintraege) {
      if (eintrag.isSymbolicLink() || ignoriert(eintrag.name)) continue;
      const pfad = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        if (ordner === wurzel && eintrag.name === FEHLER) continue;
        await lesen(pfad);
      } else if (eintrag.isFile()) {
        const s = await stat(pfad).catch(() => null);
        if (s) zustand.set(relative(wurzel, pfad), { groesse: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }
  await lesen(wurzel);
  return { zustand, uebersprungen };
}

/**
 * Wirft, wenn der Ordner einer Datei nicht mehr im Eingangsordner liegt: Ein Unterordner kann zwischen Blick und Lesen
 * (oder Entfernen) durch einen Symlink nach außen ersetzt worden sein, und O_NOFOLLOW schützt nur den Dateinamen selbst
 */
async function imOrdner(wurzel: string, rel: string): Promise<void> {
  const erwartet = join(await realpath(wurzel), dirname(rel));
  if ((await realpath(dirname(join(wurzel, rel)))) !== erwartet) throw new Error("Ordner liegt nicht mehr im Eingang");
}

/** Liest eine Datei, ohne einem Symlink zu folgen, der zwischen Blick und Lesen an ihre Stelle getreten ist */
async function lesenOhneSymlink(wurzel: string, rel: string): Promise<Uint8Array> {
  const datei = await open(join(wurzel, rel), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await imOrdner(wurzel, rel);
    return new Uint8Array(await datei.readFile());
  } finally {
    await datei.close();
  }
}

/**
 * Wirft, wenn die Datei seit dem stabilen Blick gewachsen oder geändert ist: Der Scanner schreibt nach einer Pause
 * weiter. Dann bleibt sie liegen und kommt, sobald sie wieder stabil ist, vollständig ins Archiv
 */
async function unveraendert(pfad: string, vorher: { groesse: number; mtimeMs: number }): Promise<void> {
  const s = await lstat(pfad);
  if (s.size !== vorher.groesse || s.mtimeMs !== vorher.mtimeMs)
    throw new Error("Datei hat sich während der Aufnahme geändert");
}

/** Verschiebt nach fehler/ mit demselben Unterpfad; gibt es den Namen dort schon, mit Zähler */
async function nachFehler(wurzel: string, rel: string): Promise<void> {
  await imOrdner(wurzel, rel);
  const ziel = join(wurzel, FEHLER, rel);
  await mkdir(dirname(ziel), { recursive: true });
  const endung = extname(ziel);
  const stamm = ziel.slice(0, ziel.length - endung.length);
  for (let n = 1; ; n++) {
    const kandidat = n === 1 ? ziel : `${stamm} (${n})${endung}`;
    if (!(await stat(kandidat).catch(() => null))) {
      await rename(join(wurzel, rel), kandidat);
      return;
    }
  }
}

/** Ein Teil, das als eigenes Dokument aufgenommen wird */
export interface Teil {
  bytes: Uint8Array;
  dateiname: string;
}

/**
 * Teilt eine Datei vor der Aufnahme (Stapel mit Trennblättern); null nimmt sie unverändert auf. Kommt von außen, damit
 * der Ordner ohne Barcodes testbar bleibt.
 */
export type Teilen = (bytes: Uint8Array, dateiname: string) => Promise<Teil[] | null>;

export interface Ergebnis {
  neu: number;
  doppelt: number;
  /** Je Datei, die schon im Archiv lag, die Archivnummer des vorhandenen Dokuments (fürs Log) */
  treffer: { datei: string; asn: number }[];
  /** Nach fehler/ verschoben */
  fehler: { datei: string; meldung: string }[];
  /** Liegt noch im Ordner, der nächste Blick versucht es wieder (Datenbank oder Speicher nicht erreichbar) */
  spaeter: { datei: string; meldung: string }[];
  /** Unterordner, die sich nicht lesen ließen */
  uebersprungen: Uebersprungen[];
}

/** Liest eine Datei, die sich aufnehmen lässt; sonst ein Fehler, der sie nach fehler/ bringt */
async function pruefenUndLesen(wurzel: string, rel: string, groesse: number): Promise<Uint8Array> {
  if (groesse === 0) throw new Error("Datei ist leer");
  if (groesse > MAX_DATEI) throw new Error("Datei zu groß (höchstens 100 MB)");
  return lesenOhneSymlink(wurzel, rel);
}

/** Die Unterordner einer Datei relativ zum Eingangsordner, je Ebene ein Name: „Steuer/2026/a.pdf“ → Steuer, 2026 */
export function unterordner(rel: string): string[] {
  return dirname(rel)
    .split(sep)
    .map((n) => n.trim())
    .filter((n) => n && n !== ".");
}

/** Nimmt die Teile auf, die noch nicht im Archiv liegen; für die anderen merkt es das vorhandene Dokument */
async function teileAufnehmen(
  umgebung: Umgebung,
  teile: Teil[],
  ergebnis: Ergebnis,
  { tags, akteur, rel }: { tags: string[]; akteur: string; rel: string },
): Promise<void> {
  for (const teil of teile) {
    const r = await aufnehmenEinmal(umgebung, {
      bytes: teil.bytes,
      dateiname: teil.dateiname,
      quelle: "ordner",
      akteur,
      tags,
    });
    if (r.dokument) {
      ergebnis.neu++;
      continue;
    }
    ergebnis.doppelt++;
    // Ohne Sicht hat das vorhandene Dokument immer eine Archivnummer
    const datei = teile.length > 1 ? `${anzeige(rel)} (${teil.dateiname})` : anzeige(rel);
    ergebnis.treffer.push({ datei, asn: r.vorhanden.asn ?? 0 });
  }
}

/**
 * Ein Blick in den Ordner: nimmt auf, was seit dem letzten Blick unverändert ist, und gibt den neuen Zustand für den
 * nächsten Blick zurück. Eine Datei, die schon im Archiv liegt, wird nur entfernt; ergebnis.treffer nennt das vorhandene
 * Dokument. Scheitert die Aufnahme selbst
 * (Datenbank, Speicher), bleibt die Datei liegen; nichts geht verloren, weil sie erst danach entfernt wird. Mit
 * ordnerTags (EINGANG_ORDNER_TAGS) bekommt ein neues Dokument die Namen seiner Unterordner als Tags.
 */
export async function ordnerEinlesen(
  umgebung: Umgebung,
  {
    ordner,
    zustand,
    teilen,
    ordnerTags = false,
    lesen,
    uhr = Date.now(),
  }: {
    ordner: string;
    zustand: Zustand;
    teilen?: Teilen;
    ordnerTags?: boolean;
    /** readdir; Tests stellen damit einen unlesbaren Unterordner nach */
    lesen?: typeof readdir;
    uhr?: number;
  },
): Promise<{ zustand: Zustand; ergebnis: Ergebnis }> {
  const { zustand: jetzt, uebersprungen } = await auflisten(ordner, lesen);
  const ergebnis: Ergebnis = { neu: 0, doppelt: 0, treffer: [], fehler: [], spaeter: [], uebersprungen };
  for (const rel of stabile(zustand, jetzt)) {
    const pfad = join(ordner, rel);
    const name = basename(rel);
    const vorher = zustand.get(rel)!;
    // Leer und noch jung: bleibt im Zustand und wartet, bis der Scanner schreibt oder die Wartezeit um ist
    if (vorher.groesse === 0 && uhr - vorher.mtimeMs < LEER_WARTEN_MS) continue;
    jetzt.delete(rel);
    let bytes: Uint8Array;
    try {
      bytes = await pruefenUndLesen(ordner, rel, zustand.get(rel)!.groesse);
    } catch (err) {
      ergebnis.fehler.push({ datei: anzeige(rel), meldung: meldung(err) });
      await nachFehler(ordner, rel).catch(() => {});
      continue;
    }
    try {
      await teileAufnehmen(umgebung, (await teilen?.(bytes, name)) ?? [{ bytes, dateiname: name }], ergebnis, {
        tags: ordnerTags ? unterordner(rel) : [],
        akteur: akteurFuer(rel),
        rel,
      });
    } catch (err) {
      ergebnis.spaeter.push({ datei: anzeige(rel), meldung: meldung(err) });
      continue;
    }
    // Erst jetzt liegt alles im Archiv. Lässt sich die Datei nicht entfernen, nimmt der nächste Blick sie als doppelt
    await imOrdner(ordner, rel)
      .then(() => unveraendert(pfad, zustand.get(rel)!))
      .then(() => unlink(pfad))
      .catch((err) => ergebnis.spaeter.push({ datei: anzeige(rel), meldung: meldung(err) }));
  }
  return { zustand: jetzt, ergebnis };
}
