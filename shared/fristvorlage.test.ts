import { describe, expect, it } from "vitest";
import { bisNachMonaten } from "./fristvorlage.ts";

describe("bisNachMonaten", () => {
  it("zählt Monate über Jahresgrenzen", () => {
    expect(bisNachMonaten("2026-03-15", 24)).toBe("2028-03-15");
    expect(bisNachMonaten("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("nimmt den letzten Tag, wenn es den Tag im Zielmonat nicht gibt, auch im Schaltjahr", () => {
    expect(bisNachMonaten("2026-01-31", 1)).toBe("2026-02-28");
    expect(bisNachMonaten("2027-01-31", 13)).toBe("2028-02-29");
  });
  it("gibt bei Unsinn nichts", () => {
    expect(bisNachMonaten("gestern", 3)).toBeNull();
    expect(bisNachMonaten("2026-01-01", 0)).toBeNull();
  });
});
