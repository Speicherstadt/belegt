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

  it("zählt eins in der Einzahl", () => {
    const eins = { dokumente: 1, siegel: 1, protokoll: 1, dateienGeprueft: 1 };
    expect(alsText({ ok: true, befunde: [], ...eins })).toBe(
      "1 Dokument, 1 Siegel und 1 Eintrag der Kette geprüft, 1 Original gegen seinen Hash geprüft",
    );
    const befund = { tabelle: "dokumente", zeile: "a", seq: null, befund: "Datei fehlt" };
    expect(alsText({ ok: false, befunde: [befund], ...eins })).toBe("1 Befund: dokumente a: Datei fehlt");
  });
});
