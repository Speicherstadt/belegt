import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Einmalwert } from "./Einmalwert.tsx";

const html = renderToStaticMarkup(<Einmalwert label="Neues Token:" wert="belegt_geheim123" />);

describe("Einmalwert", () => {
  it("zeigt den Wert in font-mono, umbrechend und auswählbar", () => {
    expect(html).toMatch(/<code [^>]*class="[^"]*font-mono[^"]*"[^>]*>belegt_geheim123<\/code>/);
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("select-all");
  });

  it("legt die Live-Region neben den Wert, nie um ihn", () => {
    const status = /<p role="status"[^>]*>([^<]*)<\/p>/.exec(html);
    expect(status).not.toBeNull();
    expect(status![0]).not.toContain("belegt_geheim123");
    // Die Region ist beim Laden leer, „Kopiert“ erscheint erst nach dem Klick
    expect(status![1]).toBe("");
  });

  it("hat den Knopf „Kopieren“ in Zielgröße und den Hinweis „nur jetzt“ in normaler Größe", () => {
    expect(html).toMatch(/<button type="button"[^>]*h-10[^>]*pointer-coarse:h-11[^>]*>Kopieren<\/button>/);
    expect(html).toMatch(/<p class="[^"]*">Wird nur jetzt angezeigt\.<\/p>/);
    expect(html.indexOf("Wird nur jetzt angezeigt.")).toBeGreaterThan(html.indexOf("</code>"));
  });

  it("macht den Wert per Tastatur erreichbar", () => {
    expect(html).toMatch(/<code [^>]*tabindex="0"/);
  });

  it("schreibt den Wert nirgends in ein Attribut", () => {
    expect(html.replace(/<code[^>]*>belegt_geheim123<\/code>/, "")).not.toContain("belegt_geheim123");
  });
});
