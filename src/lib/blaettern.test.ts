import { describe, expect, it } from "vitest";
import { nachbarn } from "./blaettern.ts";

const liste = { ids: ["a", "b", "c"], zurueck: "/eingang" };

describe("nachbarn", () => {
  it("kennt Vorgänger, Nachfolger und Stelle", () => {
    expect(nachbarn(liste, "b")).toEqual({ vorher: "a", weiter: "c", stelle: 2, anzahl: 3 });
  });
  it("hat am Rand nur eine Richtung", () => {
    expect(nachbarn(liste, "a")).toMatchObject({ vorher: null, weiter: "b" });
    expect(nachbarn(liste, "c")).toMatchObject({ vorher: "b", weiter: null });
  });
  it("ohne Liste oder fremde ID gibt es nichts zu blättern", () => {
    expect(nachbarn(null, "a")).toEqual({ vorher: null, weiter: null, stelle: 0, anzahl: 0 });
    expect(nachbarn(liste, "x").anzahl).toBe(0);
  });
});
