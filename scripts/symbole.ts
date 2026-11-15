import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

/*
 * Erzeugt die Symbole der installierbaren App (public/icons/) aus docs/assets/icon.svg und icon-maskable.svg; nach einer
 * Änderung am Symbol einmal ausführen und die Bilder einchecken: bun scripts/symbole.ts
 * Chromium zeichnet das SVG, weil ImageMagick dafür oft ein fehlendes Programm braucht.
 */
const ZIELE = [
  { quelle: "docs/assets/icon.svg", ziel: "public/icons/icon-192.png", groesse: 192 },
  { quelle: "docs/assets/icon.svg", ziel: "public/icons/icon-512.png", groesse: 512 },
  { quelle: "docs/assets/icon-maskable.svg", ziel: "public/icons/maskable-512.png", groesse: 512 },
  // iOS rundet die Ecken selbst und mag keine Transparenz: das randlose Symbol
  { quelle: "docs/assets/icon-maskable.svg", ziel: "public/icons/apple-touch-icon.png", groesse: 180 },
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const seite = await browser.newPage();
for (const { quelle, ziel, groesse } of ZIELE) {
  const svg = Buffer.from(await readFile(quelle)).toString("base64");
  await seite.setViewportSize({ width: groesse, height: groesse });
  await seite.setContent(
    `<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${svg}" width="${groesse}" height="${groesse}" style="display:block">`,
  );
  await seite.locator("img").evaluate((img: HTMLImageElement) => img.decode());
  await seite.screenshot({ path: ziel, omitBackground: true, clip: { x: 0, y: 0, width: groesse, height: groesse } });
}
await browser.close();
