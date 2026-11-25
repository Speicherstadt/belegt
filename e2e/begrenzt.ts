import type { Page } from "@playwright/test";

/**
 * Klickt und wiederholt nach 429, wenn die Grenze abgelaufen ist (X-Retry-After): Better Auth begrenzt Anmeldungen und
 * Codes je Adresse (server/auth.ts), und im Test kommen alle von einer Adresse
 */
export async function begrenzt(page: Page, pfad: string, klick: () => Promise<void>) {
  for (let versuch = 0; versuch < 3; versuch++) {
    const antwort = page.waitForResponse((r) => r.url().endsWith(pfad));
    await klick();
    const a = await antwort;
    if (a.status() !== 429) return;
    await page.waitForTimeout((Number(a.headers()["x-retry-after"] ?? 10) + 1) * 1000);
  }
}
