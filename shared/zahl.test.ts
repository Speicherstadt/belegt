import { describe, expect, it } from "vitest";
import { anzahl } from "./zahl.ts";

describe("anzahl", () => {
  it("nimmt bei genau 1 die Einzahl, sonst die Mehrzahl", () => {
    expect(anzahl(1, "Dokument", "Dokumente")).toBe("1 Dokument");
    expect([0, 2, 11].map((n) => anzahl(n, "Seite", "Seiten"))).toEqual(["0 Seiten", "2 Seiten", "11 Seiten"]);
  });
});
