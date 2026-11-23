import { describe, expect, it } from "vitest";
import type { Eintrag } from "../lib/api.ts";
import { zustand } from "./AuswahlListe.tsx";

const dok = (tags: string[], korrespondent?: string): Eintrag =>
  ({
    id: Math.random().toString(),
    tags: tags.map((id) => ({ id, name: id, farbe: "grau" })),
    korrespondent: korrespondent ? { id: korrespondent, name: korrespondent } : null,
    dokumenttyp: null,
  }) as unknown as Eintrag;

describe("Zustand eines Eintrags für die gewählten Dokumente", () => {
  it("Tags: alle, manche oder keine", () => {
    const gewaehlt = [dok(["a", "b"]), dok(["a"])];
    expect(zustand(gewaehlt, "tags", "a")).toBe("ja");
    expect(zustand(gewaehlt, "tags", "b")).toBe("teils");
    expect(zustand(gewaehlt, "tags", "c")).toBe("nein");
  });

  it("Korrespondent und Typ: auch „ohne“ zählt", () => {
    const gewaehlt = [dok([], "k1"), dok([])];
    expect(zustand(gewaehlt, "korrespondent", "k1")).toBe("teils");
    expect(zustand(gewaehlt, "korrespondent", null)).toBe("teils");
    expect(zustand([dok([]), dok([])], "dokumenttyp", null)).toBe("ja");
  });
});
