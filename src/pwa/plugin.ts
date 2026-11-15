import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import de from "../../messages/de.json" with { type: "json" };
import en from "../../messages/en.json" with { type: "json" };
import { manifest, OFFLINE_CACHE, OFFLINE_PFAD, TEILEN_CACHE, TEILEN_FELD, TEILEN_PFAD } from "./manifest.ts";
import { offlineSeite } from "./offline.ts";

/** Die drei Dateien der installierbaren App, mit Texten aus messages/*.json und der Version im Worker */
export function pwaDateien() {
  const offline = offlineSeite(de, en);
  const quelle = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  // Ändert sich Worker oder Hinweisseite, ändert sich die Version: Der Browser lädt den neuen Worker, der den alten Cache
  // wegräumt
  const version = createHash("sha256").update(quelle).update(offline).digest("hex").slice(0, 12);
  const konfig = {
    offlineCache: `${OFFLINE_CACHE}${version}`,
    offlinePraefix: OFFLINE_CACHE,
    offlinePfad: OFFLINE_PFAD,
    teilenCache: TEILEN_CACHE,
    teilenFeld: TEILEN_FELD,
    teilenPfad: TEILEN_PFAD,
  };
  if (!quelle.includes("/* KONFIG */ {}")) throw new Error("src/pwa/sw.js: Platzhalter für KONFIG fehlt");
  return {
    "manifest.webmanifest": { typ: "application/manifest+json", inhalt: JSON.stringify(manifest(de), null, 2) },
    "offline.html": { typ: "text/html; charset=utf-8", inhalt: offline },
    "sw.js": {
      typ: "text/javascript; charset=utf-8",
      inhalt: quelle.replace("/* KONFIG */ {}", JSON.stringify(konfig)),
    },
  };
}

/** Liefert die Dateien in der Entwicklung (Vite) aus und legt sie beim Bauen nach dist */
export function pwaPlugin(): Plugin {
  return {
    name: "belegt-pwa",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const datei = pwaDateien()[req.url?.split("?")[0]?.slice(1) as keyof ReturnType<typeof pwaDateien>];
        if (!datei || req.method !== "GET") return next();
        res.setHeader("Content-Type", datei.typ);
        res.setHeader("Cache-Control", "no-cache");
        res.end(datei.inhalt);
      });
    },
    generateBundle() {
      for (const [fileName, { inhalt }] of Object.entries(pwaDateien()))
        this.emitFile({ type: "asset", fileName, source: inhalt });
    },
  };
}
