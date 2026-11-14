import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { App } from "./gemeinsam.ts";

/**
 * Liefert die gebaute Oberfläche (vite build, Ordner dist) aus: Dateien aus dem Ordner, sonst index.html, damit
 * Adressen wie /dokumente/… beim Neuladen die App öffnen. /api und /healthz bleiben beim Server.
 */

const TYPEN: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

const KOPF = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

async function datei(pfad: string): Promise<Uint8Array | null> {
  try {
    return (await stat(pfad)).isFile() ? new Uint8Array(await readFile(pfad)) : null;
  } catch {
    return null;
  }
}

export function statischRouten(app: App, verzeichnis: string) {
  const wurzel = normalize(verzeichnis) + sep;
  app.get("*", async (c, next) => {
    const pfad = c.req.path;
    if (pfad.startsWith("/api/") || pfad === "/healthz") return next();
    let relativ: string;
    try {
      relativ = decodeURIComponent(pfad);
    } catch {
      return next();
    }
    const ziel = normalize(join(wurzel, relativ));
    // Nichts außerhalb von dist, auch nicht mit .. oder kodierten Schrägstrichen
    const inhalt = ziel.startsWith(wurzel) ? await datei(ziel) : null;
    if (inhalt)
      return c.body(new Uint8Array(inhalt), 200, {
        ...KOPF,
        "Content-Type": TYPEN[extname(ziel)] ?? "application/octet-stream",
        // Vite versieht Dateien unter assets/ mit ihrem Hash; die ändern sich nie
        "Cache-Control": pfad.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      });
    // Eine fehlende Datei mit Endung ist ein 404, eine Adresse der App bekommt index.html
    if (extname(relativ)) return next();
    const index = await datei(join(wurzel, "index.html"));
    return index
      ? c.body(new Uint8Array(index), 200, { ...KOPF, "Content-Type": TYPEN[".html"]!, "Cache-Control": "no-cache" })
      : next();
  });
}
