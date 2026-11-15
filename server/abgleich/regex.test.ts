import { describe, expect, it } from "vitest";
import { regexSuchen } from "./regex.ts";

describe("Reguläre Ausdrücke mit Zeitlimit", () => {
  it("findet, mit und ohne Groß- und Kleinschreibung, auch Umlaute", async () => {
    expect(await regexSuchen("rechnung\\s+nr\\.?\\s*\\d+", "Ihre RECHNUNG Nr. 42")).toEqual({ treffer: true });
    expect(await regexSuchen("rechnung", "Ihre RECHNUNG", { grossKleinEgal: false })).toEqual({ treffer: false });
    expect(await regexSuchen("^müller\\b", "MÜLLER GmbH")).toEqual({ treffer: true });
    expect(await regexSuchen("\\p{Lu}{3}", "abc", { grossKleinEgal: false })).toEqual({ treffer: false });
  });

  it("ein ungültiger Ausdruck trifft nicht und meldet das", async () => {
    expect(await regexSuchen("tele(kom", "telekom")).toEqual({ fehler: "ungueltig" });
    expect(await regexSuchen("telekom", "telekom")).toEqual({ treffer: true });
  });

  it("bricht katastrophales Backtracking nach dem Zeitlimit ab, danach geht es weiter", async () => {
    const start = performance.now();
    const r = await regexSuchen("^(a+)+$", `${"a".repeat(40)}!`, { zeitlimit: 100 });
    expect(r).toEqual({ fehler: "zeitlimit" });
    expect(performance.now() - start).toBeLessThan(2000);
    // Der nächste Ausdruck bekommt einen frischen Thread
    expect(await regexSuchen("a+!", `${"a".repeat(40)}!`)).toEqual({ treffer: true });
  });

  it("arbeitet gleichzeitige Anfragen nacheinander ab", async () => {
    const r = await Promise.all([
      regexSuchen("eins", "eins zwei"),
      regexSuchen("^(a+)+$", `${"a".repeat(40)}!`, { zeitlimit: 50 }),
      regexSuchen("drei", "eins zwei"),
    ]);
    expect(r).toEqual([{ treffer: true }, { fehler: "zeitlimit" }, { treffer: false }]);
  });
});
