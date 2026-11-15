/*
 * Service Worker von Belegt, von Hand geschrieben und bewusst klein (src/pwa/plugin.ts setzt KONFIG ein):
 * - hält nur die Seite ohne Verbindung vor; Antworten der Schnittstelle, Dokumente und die Oberfläche selbst cacht er
 *   nicht, die Archivdaten bleiben auf dem Server;
 * - nimmt geteilte Dateien an (share_target im Manifest), legt sie bis zum Hochladen in einen eigenen Cache und leitet
 *   auf die Seite /teilen der App um. Hochgeladen wird erst dort nach einem Klick, mit der normalen Anmeldung und
 *   CSRF-Prüfung; der Server selbst nimmt unter /teilen nichts an.
 * Eine neue Version übernimmt sofort (skipWaiting, clients.claim) und räumt die alten Caches weg.
 */
const KONFIG = /* KONFIG */ {};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(KONFIG.offlineCache);
      await cache.add(new Request(KONFIG.offlinePfad, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(KONFIG.offlinePraefix) && name !== KONFIG.offlineCache) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Legt die geteilten Dateien in den Cache, jede unter einer eigenen Adresse mit Name und Typ im Kopf */
async function teilenAnnehmen(request) {
  // Das Betriebssystem schickt keinen Referrer; ein Formular einer fremden Seite meist schon. Ganz verhindern lässt sich
  // ein fremdes Formular hier nicht (Referrer lässt sich abschalten), deshalb lädt erst ein Klick auf /teilen hoch
  const fremd = request.referrer && new URL(request.referrer).origin !== self.location.origin;
  const form = fremd ? null : await request.formData().catch(() => null);
  const dateien = form ? form.getAll(KONFIG.teilenFeld).filter((d) => d instanceof File && d.size > 0) : [];
  if (dateien.length) {
    // Was vorher geteilt und nicht erledigt wurde, ersetzt das neue Teilen
    await caches.delete(KONFIG.teilenCache);
    const cache = await caches.open(KONFIG.teilenCache);
    await Promise.all(
      dateien.map((datei, i) =>
        cache.put(
          new Request(`${KONFIG.teilenPfad}/datei/${i}`),
          new Response(datei, {
            headers: {
              "content-type": datei.type || "application/octet-stream",
              "x-belegt-name": encodeURIComponent(datei.name || `datei-${i + 1}`),
            },
          }),
        ),
      ),
    );
  }
  return Response.redirect(new URL(KONFIG.teilenPfad, self.location.origin).href, 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && url.pathname === KONFIG.teilenPfad) {
    event.respondWith(teilenAnnehmen(request));
    return;
  }
  // Nur Seiten der App, nie /api: aus dem Netz, ohne Verbindung die Hinweisseite. Gespeichert wird nichts
  if (request.mode !== "navigate" || request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).catch(async () => (await caches.match(KONFIG.offlinePfad)) ?? Response.error()));
});
