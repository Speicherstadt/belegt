import { TEILEN_CACHE } from "./manifest.ts";

/*
 * Dateien, die das Betriebssystem an Belegt geteilt hat: Der Service Worker (sw.js) legt sie in einen eigenen Cache,
 * bis die Seite /teilen sie hochlädt oder verworfen werden. Sie liegen nur in diesem Browser.
 */

const cacheDa = () => typeof caches !== "undefined";

/** Die geteilten Dateien mit ihrem Eintrag im Cache, in der Reihenfolge, in der sie kamen */
async function eintraege(): Promise<{ anfrage: Request; datei: File }[]> {
  if (!cacheDa() || !(await caches.has(TEILEN_CACHE))) return [];
  const cache = await caches.open(TEILEN_CACHE);
  const anfragen = [...(await cache.keys())].sort(
    (a, b) => Number(a.url.split("/").pop()) - Number(b.url.split("/").pop()),
  );
  const liste: { anfrage: Request; datei: File }[] = [];
  for (const anfrage of anfragen) {
    const antwort = await cache.match(anfrage);
    if (!antwort) continue;
    const name = decodeURIComponent(antwort.headers.get("x-belegt-name") ?? "datei");
    liste.push({
      anfrage,
      datei: new File([await antwort.blob()], name, { type: antwort.headers.get("content-type") ?? "" }),
    });
  }
  return liste;
}

/** Die geteilten Dateien in der Reihenfolge, in der sie kamen */
export async function geteilteDateien(): Promise<File[]> {
  return (await eintraege()).map((e) => e.datei);
}

/**
 * Lädt die geteilten Dateien nacheinander hoch und entfernt jede, sobald sie angekommen ist: Scheitert eine, lädt ein
 * zweiter Versuch nur den Rest hoch, ohne doppelte Dokumente. Gibt die Zahl der hochgeladenen zurück.
 */
export async function geteiltHochladen(hochladen: (datei: File) => Promise<unknown>): Promise<number> {
  const liste = await eintraege();
  for (const { anfrage, datei } of liste) {
    await hochladen(datei);
    await (await caches.open(TEILEN_CACHE)).delete(anfrage);
  }
  await geteilteVerwerfen();
  return liste.length;
}

export async function hatGeteilteDateien(): Promise<boolean> {
  return cacheDa() && (await caches.has(TEILEN_CACHE));
}

/** Löscht die Zwischenablage; nach dem Hochladen, beim Verwerfen und beim Abmelden */
export async function geteilteVerwerfen(): Promise<void> {
  if (cacheDa()) await caches.delete(TEILEN_CACHE).catch(() => false);
}
