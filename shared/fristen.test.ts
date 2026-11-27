import { describe, expect, it } from "vitest";
import { fristende, gesetzlicheJahre, loeschbar } from "./fristen.ts";

describe("gesetzlicheJahre (§ 147 Abs. 3 AO)", () => {
  it("zehn Jahre für Bücher und Zoll, acht für Belege, sechs für Briefe und Sonstiges", () => {
    expect(gesetzlicheJahre("buecher")).toBe(10);
    expect(gesetzlicheJahre("zoll")).toBe(10);
    expect(gesetzlicheJahre("beleg")).toBe(8);
    expect(gesetzlicheJahre("geschaeftsbrief")).toBe(6);
    expect(gesetzlicheJahre("sonstige")).toBe(6);
  });

  it("zehn Jahre für Belege unter Bank-, Wertpapier- oder Versicherungsaufsicht (Art. 97 § 19a Abs. 3 EGAO)", () => {
    expect(gesetzlicheJahre("beleg", { aufsicht: true })).toBe(10);
    expect(gesetzlicheJahre("geschaeftsbrief", { aufsicht: true })).toBe(6);
  });

  it("keine gesetzliche Frist für freiwillige und freie Ablage", () => {
    expect(gesetzlicheJahre("freiwillig")).toBeNull();
    expect(gesetzlicheJahre("frei")).toBeNull();
  });
});

describe("fristende (§ 147 Abs. 4 AO: ab Schluss des Kalenderjahres)", () => {
  it("rechnet vom Jahresende, egal ob die Unterlage im Januar oder Dezember entstand", () => {
    expect(fristende("beleg", "2026-01-02")).toEqual({ bis: "2034-12-31", grund: "gesetz" });
    expect(fristende("beleg", "2026-12-31")).toEqual({ bis: "2034-12-31", grund: "gesetz" });
    expect(fristende("buecher", "2026-06-30").bis).toBe("2036-12-31");
    expect(fristende("geschaeftsbrief", "2026-03-15").bis).toBe("2032-12-31");
  });

  it("gibt Belegen von 2017 acht Jahre, also bis Ende 2025 (Übergang nach Art. 97 § 19a Abs. 2 EGAO)", () => {
    expect(fristende("beleg", "2017-05-10").bis).toBe("2025-12-31");
    expect(fristende("beleg", "2017-05-10", { aufsicht: true }).bis).toBe("2027-12-31");
  });

  it("nimmt bei freiwilliger Aufbewahrung das gewählte Datum", () => {
    expect(fristende("freiwillig", "2026-11-11", { freiwilligBis: "2033-12-31" })).toEqual({
      bis: "2033-12-31",
      grund: "freiwillig",
    });
    expect(() => fristende("freiwillig", "2026-11-11")).toThrow(/bis wann/);
    expect(() => fristende("freiwillig", "2026-11-11", { freiwilligBis: "2020-01-01" })).toThrow(/vor der Entstehung/);
  });

  it("sperrt freie Ablage nicht", () => {
    expect(fristende("frei", "2026-11-11")).toEqual({ bis: null, grund: "keine" });
  });

  it("lehnt Daten in anderem Format ab", () => {
    expect(() => fristende("beleg", "11.11.2026")).toThrow(/JJJJ-MM-TT/);
  });

  it("lehnt Tage ab, die es nicht gibt", () => {
    expect(() => fristende("freiwillig", "2026-11-11", { freiwilligBis: "2026-13-99" })).toThrow(/gibt es nicht/);
    expect(() => fristende("beleg", "2026-02-30")).toThrow(/gibt es nicht/);
    expect(() => fristende("beleg", "0000-01-01")).toThrow(/zu früh/);
    expect(() => fristende("beleg", "0001-01-01")).toThrow(/zu früh/);
    expect(() => fristende("frei", "0999-12-31")).toThrow(/zu früh/);
    expect(() => fristende("freiwillig", "2026-11-11", { freiwilligBis: "0500-01-01" })).toThrow(/zu früh/);
    expect(() => loeschbar({ bis: null, grund: "keine" }, "0001-01-01")).toThrow(/zu früh/);
    expect(fristende("beleg", "1000-01-01").bis).toBe("1008-12-31");
    expect(() => fristende("beleg", "9995-03-12", { aufsicht: true })).toThrow(/zu weit in der Zukunft/);
    expect(() => fristende("buecher", "9999-06-01")).toThrow(/zu weit in der Zukunft/);
    expect(fristende("beleg", "9991-03-12").bis).toBe("9999-12-31");
    expect(fristende("beleg", "2028-02-29").bis).toBe("2036-12-31");
  });
});

describe("loeschbar", () => {
  it("erst nach dem letzten Tag der Frist", () => {
    const frist = fristende("beleg", "2017-05-10");
    expect(loeschbar(frist, "2025-12-31")).toBe(false);
    expect(loeschbar(frist, "2026-01-01")).toBe(true);
  });

  it("freie Ablage jederzeit", () => {
    expect(loeschbar(fristende("frei", "2026-11-11"), "2026-11-11")).toBe(true);
  });
});
