import { describe, expect, it } from "vitest";
import { trefferTeile } from "./treffer.ts";

describe("trefferTeile", () => {
  it("markiert jedes Suchwort, egal wie geschrieben", () => {
    expect(trefferTeile("Stromrechnung März Strom", "strom")).toEqual([
      { text: "Strom", treffer: true },
      { text: "rechnung März ", treffer: false },
      { text: "Strom", treffer: true },
    ]);
  });
  it("nimmt mehrere Wörter, ignoriert Anführungszeichen und Wörter unter zwei Zeichen", () => {
    expect(trefferTeile("Rechnung a Kopie", '"rechnung" a kopie').filter((t) => t.treffer)).toEqual([
      { text: "Rechnung", treffer: true },
      { text: "Kopie", treffer: true },
    ]);
  });
  it("Sonderzeichen der Suche sind Text, kein Muster", () => {
    expect(trefferTeile("Rechnung (Kopie)", "(kopie)").filter((t) => t.treffer)).toEqual([
      { text: "(Kopie)", treffer: true },
    ]);
  });
  it("ohne Suche bleibt der Text ein Stück", () => {
    expect(trefferTeile("Brief", "")).toEqual([{ text: "Brief", treffer: false }]);
  });
});
