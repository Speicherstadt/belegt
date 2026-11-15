import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import de from "../../messages/de.json" with { type: "json" };
import en from "../../messages/en.json" with { type: "json" };
import { manifest, TEILEN_FELD, TEILEN_PFAD } from "./manifest.ts";
import { offlineSeite } from "./offline.ts";
import { pwaDateien } from "./plugin.ts";
import { workerAnmelden } from "./registrieren.ts";

/** Breite und Höhe aus dem Kopf einer PNG-Datei (IHDR) */
function pngGroesse(pfad: string) {
  const b = readFileSync(new URL(`../../public${pfad}`, import.meta.url));
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

describe("Manifest der installierbaren App", () => {
  const m = manifest(de);

  it("nennt Belegt mit dem Satz aus den Texten und startet eigenständig auf /", () => {
    expect(m).toMatchObject({
      name: "Belegt",
      short_name: "Belegt",
      description: de.app_claim,
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("hat Symbole in 192 und 512, eines maskierbar, und jede Datei hat die genannte Größe", () => {
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const symbol of m.icons) expect(pngGroesse(symbol.src)).toBe(symbol.sizes);
    expect(pngGroesse("/icons/apple-touch-icon.png")).toBe("180x180");
  });

  it("nimmt geteilte Dateien per POST als multipart an /teilen an", () => {
    expect(m.share_target).toMatchObject({ action: TEILEN_PFAD, method: "POST", enctype: "multipart/form-data" });
    const [dateien] = m.share_target.params.files;
    expect(dateien?.name).toBe(TEILEN_FELD);
    for (const typ of ["application/pdf", "image/*", ".docx", ".xlsx", "message/rfc822", ".eml"])
      expect(dateien?.accept).toContain(typ);
  });
});

describe("Dateien für Browser und Build", () => {
  it("setzt die Einstellungen in den Worker ein und nennt eine Version, die sich mit dem Inhalt ändert", () => {
    const sw = pwaDateien()["sw.js"].inhalt;
    expect(sw).not.toContain("/* KONFIG */ {}");
    const konfig = JSON.parse(/const KONFIG = (\{.*\});/.exec(sw)![1]!);
    expect(konfig).toMatchObject({ teilenPfad: "/teilen", teilenFeld: "dateien", offlinePfad: "/offline.html" });
    expect(konfig.offlineCache).toMatch(/^belegt-offline-[0-9a-f]{12}$/);
    expect(pwaDateien()["manifest.webmanifest"].typ).toBe("application/manifest+json");
  });

  it("cacht im Worker nur die Hinweisseite, nie Antworten von /api", () => {
    const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
    // Ein einziges cache.add (die Hinweisseite) und put nur in den Cache der geteilten Dateien
    expect(sw.match(/cache\.add\(/g)).toHaveLength(1);
    expect(sw.match(/\.put\(/g)).toHaveLength(1);
    expect(sw).toContain('url.pathname.startsWith("/api/")');
  });

  it("zeigt ohne Verbindung einen Hinweis auf Deutsch und Englisch, ohne fremde Inhalte", () => {
    const seite = offlineSeite(de, en);
    expect(seite).toContain(de.offline_title);
    expect(seite).toContain(en.offline_text);
    expect(seite).not.toMatch(/<(link|img|iframe)\b|src=/);
    const boese = { ...de, offline_title: "<script>x</script>" };
    expect(offlineSeite(boese, { ...en, offline_text: "</script><b>" })).not.toMatch(/<script>x|<\/script><b>/);
  });
});

describe("Service Worker anmelden", () => {
  const navigator = () => ({ serviceWorker: { register: vi.fn(async () => ({})) } }) as unknown as Navigator;

  it("meldet /sw.js für die ganze App an, aber nicht eingebettet in einem Frame", () => {
    const oben = navigator();
    workerAnmelden({ navigator: oben, imFrame: false });
    expect(oben.serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    const frame = navigator();
    workerAnmelden({ navigator: frame, imFrame: true });
    expect(frame.serviceWorker.register).not.toHaveBeenCalled();
    expect(() => workerAnmelden({ navigator: {} as Navigator, imFrame: false })).not.toThrow();
  });
});
