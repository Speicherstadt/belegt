// Rendert social-preview.html nach docs/social-preview.png (1280 × 640). Aufruf: bun run docs:social-preview
// (braucht bun install und den Chromium von Playwright; PW_CHROMIUM_PATH wie in playwright.config.ts)
import { join } from "node:path";
import { chromium } from "@playwright/test";

const hier = import.meta.dir;
const ziel = join(hier, "../../docs/social-preview.png");
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.goto(`file://${join(hier, "social-preview.html")}`);
await page.evaluate(async () => {
  await document.fonts.load('650 44px "Geist"');
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode()));
});
await page.screenshot({ path: ziel, type: "png" });
await browser.close();
console.log("geschrieben:", ziel);
