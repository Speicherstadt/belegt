import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEILEN_CACHE } from "./manifest.ts";
import { geteilteDateien, geteiltHochladen } from "./teilen.ts";

/** Cache Storage im Speicher, so weit sw.js und teilen.ts ihn brauchen */
function cacheSpeicher() {
  const caches = new Map<string, Map<string, Response>>();
  const url = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const offen = (name: string) => {
    const eintraege = caches.get(name) ?? new Map<string, Response>();
    caches.set(name, eintraege);
    return {
      keys: async () => [...eintraege.keys()].map((u) => new Request(u)),
      match: async (r: Request | string) => eintraege.get(url(r))?.clone(),
      put: async (r: Request | string, antwort: Response) => void eintraege.set(url(r), antwort),
      delete: async (r: Request | string) => eintraege.delete(url(r)),
    };
  };
  return {
    has: async (name: string) => caches.has(name),
    open: async (name: string) => offen(name),
    delete: async (name: string) => caches.delete(name),
  };
}

describe("Hochladen geteilter Dateien", () => {
  beforeEach(async () => {
    vi.stubGlobal("caches", cacheSpeicher());
    const cache = await caches.open(TEILEN_CACHE);
    for (const [i, name] of ["a.pdf", "b.pdf", "c.pdf"].entries())
      await cache.put(
        new Request(`https://belegt.test/teilen/datei/${i}`),
        new Response(name, { headers: { "content-type": "application/pdf", "x-belegt-name": name } }),
      );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("entfernt jede angekommene Datei sofort, ein zweiter Versuch lädt nur den Rest hoch", async () => {
    const angekommen: string[] = [];
    const scheitertBei = (name: string | null) => async (datei: File) => {
      if (datei.name === name) throw new Error("Netz weg");
      angekommen.push(datei.name);
    };
    await expect(geteiltHochladen(scheitertBei("b.pdf"))).rejects.toThrow("Netz weg");
    expect((await geteilteDateien()).map((d) => d.name)).toEqual(["b.pdf", "c.pdf"]);
    expect(await geteiltHochladen(scheitertBei(null))).toBe(2);
    expect(angekommen).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(await caches.has(TEILEN_CACHE)).toBe(false);
  });
});
