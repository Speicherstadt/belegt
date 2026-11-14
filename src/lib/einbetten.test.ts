import { describe, expect, it } from "vitest";
import { istAppPfad, istEingebettet, nachrichtLesen } from "./einbetten.ts";

describe("Einbetten", () => {
  const parent = {};
  const erwartet = { origin: "https://portal.example", parent };

  it("nimmt Nachrichten nur vom Elternfenster unter dem einen Origin und in bekannter Form", () => {
    const theme = { type: "theme", theme: "dark" };
    expect(nachrichtLesen({ origin: "https://portal.example", source: parent, data: theme }, erwartet)).toEqual(theme);
    expect(nachrichtLesen({ origin: "https://fremd.example", source: parent, data: theme }, erwartet)).toBeNull();
    expect(nachrichtLesen({ origin: "https://portal.example", source: {}, data: theme }, erwartet)).toBeNull();
    expect(
      nachrichtLesen(
        { origin: "https://portal.example", source: parent, data: { type: "theme", theme: "lila" } },
        erwartet,
      ),
    ).toBeNull();
  });

  it("lässt nur Pfade dieser App zu, nie eine andere Seite", () => {
    expect(istAppPfad("/archiv")).toBe(true);
    expect(istAppPfad("/dokumente/123?x=1")).toBe(true);
    for (const p of [
      "//fremd.example",
      "/\\fremd.example",
      "https://fremd.example",
      "javascript:alert(1)",
      "/\t/fremd.example",
    ])
      expect(istAppPfad(p)).toBe(false);
  });

  it("gilt nur im Frame, nur mit Origin und nur mit Parameter oder gemerkt als eingebettet", () => {
    const basis = { search: "?embedded=1", gemerkt: false, imFrame: true, embedOrigin: "https://portal.example" };
    expect(istEingebettet(basis)).toBe(true);
    expect(istEingebettet({ ...basis, imFrame: false })).toBe(false);
    expect(istEingebettet({ ...basis, embedOrigin: null })).toBe(false);
    expect(istEingebettet({ ...basis, search: "" })).toBe(false);
    expect(istEingebettet({ ...basis, search: "", gemerkt: true })).toBe(true);
  });
});
