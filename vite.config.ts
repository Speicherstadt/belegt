import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Der Server von Belegt; im Betrieb liefert er die App selbst aus */
const server = process.env.BELEGT_SERVER ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [
    // Sprache des Browsers, sonst Deutsch
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["preferredLanguage", "baseLocale"],
    }),
    tailwindcss(),
    react(),
  ],
  server: { proxy: { "/api": { target: server }, "/healthz": { target: server } } },
});
