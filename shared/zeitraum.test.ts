import { describe, expect, it } from "vitest";
import { zeitraumGrenzen } from "./zeitraum.ts";

const heute = new Date(2026, 2, 3); // 3. März 2026
const eigen = { von: "2020-01-01", bis: "" };

describe("zeitraumGrenzen", () => {
  it("zählt den heutigen Tag mit und geht über Monatsgrenzen", () => {
    expect(zeitraumGrenzen("7t", eigen, heute)).toEqual({ von: "2026-02-25", bis: "2026-03-03" });
    expect(zeitraumGrenzen("30t", eigen, heute)).toEqual({ von: "2026-02-02", bis: "2026-03-03" });
  });

  it("kennt dieses und letztes Jahr", () => {
    expect(zeitraumGrenzen("jahr", eigen, heute)).toEqual({ von: "2026-01-01", bis: "2026-12-31" });
    expect(zeitraumGrenzen("vorjahr", eigen, heute)).toEqual({ von: "2025-01-01", bis: "2025-12-31" });
  });

  it("nimmt beim eigenen Zeitraum die Eingaben und ohne Zeitraum keine Grenze", () => {
    expect(zeitraumGrenzen("eigen", eigen, heute)).toEqual(eigen);
    expect(zeitraumGrenzen("", eigen, heute)).toEqual({ von: "", bis: "" });
  });
});
