import { describe, expect, it } from "vitest";
import { betragAlsText, betragAusText, FARBEN, GRENZE, kontrast } from "./ordnung.ts";

describe("Betrag aus deutscher Schreibweise", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1234", 123400],
    ["0,5", 50],
    ["12,05", 1205],
    ["-12,5", -1250],
    ["1.000.000", 100000000],
    [" 99,99 € ", 9999],
    ["7 EUR", 700],
    ["0", 0],
    ["-0,00", 0],
    ["007,10", 710],
  ])("„%s“ ist %i Cent", (text, cent) => {
    expect(betragAusText(text)).toBe(cent);
  });

  it.each(["", "abc", "1,234.56", "12,345", "1.23,00", "1.2345", "1234.56", ",5", "1,", "--1", "+1", "1e3", "١٢"])(
    "„%s“ ist kein Betrag",
    (text) => {
      expect(betragAusText(text)).toBeNull();
    },
  );

  it("nimmt Beträge bis zur Grenze und keine darüber", () => {
    const groesster = `${String(GRENZE / 100)},00`;
    expect(betragAusText(groesster)).toBe(GRENZE);
    expect(betragAusText(`${String(GRENZE / 100)},01`)).toBeNull();
    expect(betragAusText("99999999999999999999,99")).toBeNull();
    expect(Number.isSafeInteger(GRENZE)).toBe(true);
  });

  it("schreibt Cent zurück ohne Tausenderpunkte", () => {
    expect(betragAlsText(123456)).toBe("1234,56");
    expect(betragAlsText(5)).toBe("0,05");
    expect(betragAlsText(-1250)).toBe("-12,50");
    expect(betragAusText(betragAlsText(-987654321))).toBe(-987654321);
  });
});

describe("Farben der Tags", () => {
  it.each(Object.entries(FARBEN))("%s erreicht 4,5:1 zwischen Schrift und Hintergrund", (_, f) => {
    expect(kontrast(f.schrift, f.hintergrund)).toBeGreaterThanOrEqual(4.5);
  });

  it("rechnet den Kontrast wie WCAG", () => {
    expect(kontrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(kontrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
