/**
 * Meldet den Service Worker an (src/pwa/sw.js), nicht in einem Frame: Eingebettet gehört Belegt zur Seite eines
 * anderen, dort gibt es nichts zu installieren und nichts zu teilen.
 */
export function workerAnmelden(f: { navigator: Navigator; imFrame: boolean }) {
  if (f.imFrame || !("serviceWorker" in f.navigator)) return;
  f.navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // Ohne Worker läuft die App genauso, nur ohne Hinweis ohne Verbindung und ohne Teilen
  });
}
