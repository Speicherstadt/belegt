import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DARSTELLUNG_SKRIPT } from "./src/lib/darstellung.ts";
import { pwaPlugin } from "./src/pwa/plugin.ts";

/** Der Server von Belegt; im Betrieb liefert er die App selbst aus */
const server = process.env.BELEGT_SERVER ?? "http://127.0.0.1:3000";

/*
 * Die Demo (bun run build:demo, docs/entwicklung.md): dieselbe App unter /demo/, ohne Server und ohne Service Worker;
 * src/demo/ beantwortet /api aus der Aufnahme
 */
export default defineConfig(({ mode }) => ({
  base: mode === "demo" ? "/demo/" : "/",
  build: mode === "demo" ? { outDir: "dist-demo", assetsInlineLimit: 0 } : undefined,
  plugins: [
    // Sprache des Browsers, sonst Deutsch
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["preferredLanguage", "baseLocale"],
    }),
    tailwindcss(),
    react(),
    // Hell oder dunkel aus dem Browser setzen, bevor die Seite gezeichnet wird
    {
      name: "belegt-darstellung",
      transformIndexHtml: () => [{ tag: "script", children: DARSTELLUNG_SKRIPT, injectTo: "head-prepend" }],
    },
    // Manifest, Service Worker und Seite ohne Verbindung (src/pwa/)
    mode === "demo" ? null : pwaPlugin(),
  ],
  server: { proxy: { "/api": { target: server }, "/healthz": { target: server } } },
}));
