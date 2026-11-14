import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { sql } from "drizzle-orm";
import { aufnehmen, type Umgebung } from "../dokumente/dokumente.ts";

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

/** Alle Dateien unter dem Ordner, rekursiv, ohne fehler/, versteckte Ordner und Symlinks (die könnten hinausführen) */
export async function auflisten(wurzel: string): Promise<Zustand> {
  const zustand: Zustand = new Map();
  async function lesen(ordner: string) {
    for (const eintrag of await readdir(ordner, { withFileTypes: true })) {
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
  return zustand;
}

/** Liest eine Datei, ohne einem Symlink zu folgen, der zwischen Blick und Lesen an ihre Stelle getreten ist */
async function lesenOhneSymlink(pfad: string): Promise<Uint8Array> {
  const datei = await open(pfad, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return new Uint8Array(await datei.readFile());
  } finally {
    await datei.close();
  }
}

/** Verschiebt nach fehler/ mit demselben Unterpfad; gibt es den Namen dort schon, mit Zähler */
async function nachFehler(wurzel: string, rel: string): Promise<void> {
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

/** Ob eine Datei mit diesem Hash schon im Archiv liegt (nicht gelöscht) */
async function schonImArchiv(db: Umgebung["db"], sha256: string): Promise<boolean> {
  const zeilen = await db.execute(sql`
    select 1 from dokumente d where d.sha256 = ${sha256}
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     limit 1`);
  return zeilen.length > 0;
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
  /** Nach fehler/ verschoben */
  fehler: { datei: string; meldung: string }[];
  /** Liegt noch im Ordner, der nächste Blick versucht es wieder (Datenbank oder Speicher nicht erreichbar) */
  spaeter: { datei: string; meldung: string }[];
}

const meldung = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 300);
const anzeige = (rel: string) => rel.split(sep).join("/");

/** Liest eine Datei, die sich aufnehmen lässt; sonst ein Fehler, der sie nach fehler/ bringt */
async function pruefenUndLesen(pfad: string, groesse: number): Promise<Uint8Array> {
  if (groesse === 0) throw new Error("Datei ist leer");
  if (groesse > MAX_DATEI) throw new Error("Datei zu groß (höchstens 100 MB)");
  return lesenOhneSymlink(pfad);
}

/** Die Unterordner einer Datei relativ zum Eingangsordner, je Ebene ein Name: „Steuer/2026/a.pdf“ → Steuer, 2026 */
export function unterordner(rel: string): string[] {
  return dirname(rel)
    .split(sep)
    .map((n) => n.trim())
    .filter((n) => n && n !== ".");
}

/** Nimmt die Teile auf, die noch nicht im Archiv liegen */
async function teileAufnehmen(umgebung: Umgebung, teile: Teil[], ergebnis: Ergebnis, tags: string[]): Promise<void> {
  for (const teil of teile) {
    const sha256 = createHash("sha256").update(teil.bytes).digest("hex");
    if (await schonImArchiv(umgebung.db, sha256)) {
      ergebnis.doppelt++;
      continue;
    }
    await aufnehmen(umgebung, { bytes: teil.bytes, dateiname: teil.dateiname, quelle: "ordner", akteur: AKTEUR, tags });
    ergebnis.neu++;
  }
}

/**
 * Ein Blick in den Ordner: nimmt auf, was seit dem letzten Blick unverändert ist, und gibt den neuen Zustand für den
 * nächsten Blick zurück. Eine Datei, die schon im Archiv liegt, wird nur entfernt. Scheitert die Aufnahme selbst
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
  }: { ordner: string; zustand: Zustand; teilen?: Teilen; ordnerTags?: boolean },
): Promise<{ zustand: Zustand; ergebnis: Ergebnis }> {
  const jetzt = await auflisten(ordner);
  const ergebnis: Ergebnis = { neu: 0, doppelt: 0, fehler: [], spaeter: [] };
  for (const rel of stabile(zustand, jetzt)) {
    const pfad = join(ordner, rel);
    const name = basename(rel);
    jetzt.delete(rel);
    let bytes: Uint8Array;
    try {
      bytes = await pruefenUndLesen(pfad, zustand.get(rel)!.groesse);
    } catch (err) {
      ergebnis.fehler.push({ datei: anzeige(rel), meldung: meldung(err) });
      await nachFehler(ordner, rel).catch(() => {});
      continue;
    }
    try {
      await teileAufnehmen(
        umgebung,
        (await teilen?.(bytes, name)) ?? [{ bytes, dateiname: name }],
        ergebnis,
        ordnerTags ? unterordner(rel) : [],
      );
    } catch (err) {
      ergebnis.spaeter.push({ datei: anzeige(rel), meldung: meldung(err) });
      continue;
    }
    // Erst jetzt liegt alles im Archiv. Lässt sich die Datei nicht entfernen, nimmt der nächste Blick sie als doppelt
    await unlink(pfad).catch((err) => ergebnis.spaeter.push({ datei: anzeige(rel), meldung: meldung(err) }));
  }
  return { zustand: jetzt, ergebnis };
}
