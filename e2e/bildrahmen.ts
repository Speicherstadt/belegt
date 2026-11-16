import type { Browser } from "@playwright/test";

/**
 * Rahmen um die Bilder in README und Doku. Die Ränder der Oberfläche sind so hell wie GitHub hell und fast so dunkel
 * wie GitHub dunkel; ohne Rahmen verschwindet die Bildkante. GitHub nimmt kein CSS an, deshalb steckt der Rahmen im
 * PNG: feine Kante, abgerundete Ecken und ein transparenter Rand, hell ein Schatten nach unten, dunkel ein Schein.
 * Unten ist der Rand für den Schatten breiter; hell und dunkel sind gleich groß. Die Doku zeichnet um diese Bilder
 * keinen eigenen Rahmen (docs/assets/startseite.css).
 */
export const RAHMEN_RAND = { oben: 24, seite: 32, unten: 48 };

const RAHMEN = {
  hell: "0 0 0 1px rgb(0 0 0 / 0.08), 0 12px 28px rgb(0 0 0 / 0.16)",
  dunkel: "0 0 0 1px rgb(255 255 255 / 0.16), 0 0 20px 1px rgb(255 255 255 / 0.08)",
} as const;

export type Modus = keyof typeof RAHMEN;

/** Breite und Höhe aus dem IHDR-Block eines PNG */
const pngGroesse = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** Legt den Rahmen um ein PNG; radius in CSS-Pixeln (das Handy-Bild bekommt größere Ecken) */
export async function mitRahmen(browser: Browser, png: Buffer, modus: Modus, radius = 12): Promise<Buffer> {
  const { width, height } = pngGroesse(png);
  const page = await browser.newPage({
    viewport: { width: width + 2 * RAHMEN_RAND.seite, height: height + RAHMEN_RAND.oben + RAHMEN_RAND.unten },
  });
  try {
    await page.setContent(
      `<body style="margin:0;background:transparent"><img alt="" style="display:block;margin:${RAHMEN_RAND.oben}px ${RAHMEN_RAND.seite}px ${RAHMEN_RAND.unten}px;width:${width}px;height:${height}px;border-radius:${radius}px;box-shadow:${RAHMEN[modus]}" src="data:image/png;base64,${png.toString("base64")}"></body>`,
    );
    await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
    return await page.screenshot({ omitBackground: true, type: "png" });
  } finally {
    await page.close();
  }
}
