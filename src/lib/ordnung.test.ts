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
});
