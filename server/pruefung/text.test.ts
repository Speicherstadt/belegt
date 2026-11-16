import { describe, expect, it } from "vitest";
import { alsText } from "./text.ts";

describe("Ergebnis der Prüfung als Zeile (Test-Restore)", () => {
  const basis = { dokumente: 3, siegel: 5, protokoll: 9, dateienGeprueft: 3 };

  it("nennt, was geprüft ist", () => {
    expect(alsText({ ok: true, befunde: [], ...basis })).toBe(
      "3 Dokumente, 5 Siegel und 9 Einträge der Kette geprüft, 3 Originale gegen ihren Hash geprüft",
    );
  });

  it("nennt die Zahl der Befunde und die ersten drei", () => {
    const befund = (zeile: string) => ({ tabelle: "dokumente", zeile, seq: null, befund: "Datei fehlt" });
    expect(alsText({ ok: false, befunde: ["a", "b", "c", "d"].map(befund), ...basis })).toBe(
      "4 Befunde: dokumente a: Datei fehlt; dokumente b: Datei fehlt; dokumente c: Datei fehlt",
    );
  });
});
