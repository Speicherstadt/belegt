import { describe, expect, it } from "vitest";
import type { Feld } from "./api.ts";
import { filterParameter, LEERER_FILTER } from "./ordnung.ts";

const summe: Feld = { id: "0b6f2f4e-1c1a-4d8e-9a57-3f0c7b0d2a11", name: "Summe", typ: "betrag", optionen: [] };

describe("filterParameter", () => {
  it("schickt einen Betrag in Euro als Cent: „100“ ist 100 €, nicht 100 Cent", () => {
    const p = new URLSearchParams(
      filterParameter(
        { ...LEERER_FILTER, feld: { feldId: summe.id, art: "bereich", text: "", von: "100", bis: "1.234,5" } },
        [summe],
      ).slice(1),
    );
    expect(p.get(`feld.${summe.id}.von`)).toBe("10000");
    expect(p.get(`feld.${summe.id}.bis`)).toBe("123450");
  });

  it("schickt ausgeschlossene Tags und „ohne Tag“", () => {
    expect(filterParameter({ ...LEERER_FILTER, tagsNicht: ["a", "b"], ohneTags: true }, [])).toBe(
      "&tagNicht=a&tagNicht=b&ohneTags=1",
    );
  });

  it("macht aus dem Zeitraum feste Grenzen für die gewählte Art", () => {
    const eigen = filterParameter(
      { ...LEERER_FILTER, datumArt: "eingegangen", zeitraum: "eigen", datumVon: "2026-01-01", datumBis: "" },
      [],
    );
    expect(eigen).toBe("&eingegangenVon=2026-01-01");
    const jahr = new Date().getFullYear();
    expect(filterParameter({ ...LEERER_FILTER, zeitraum: "vorjahr" }, [])).toBe(
      `&entstandenVon=${jahr - 1}-01-01&entstandenBis=${jahr - 1}-12-31`,
    );
  });
});
