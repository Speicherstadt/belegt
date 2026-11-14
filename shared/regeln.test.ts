import { describe, expect, it } from "vitest";
import { type Regel, vorschlagen } from "./regeln.ts";

const regeln: Regel[] = [
  { id: "r1", name: "Newsletter", wenn: { betreffEnthaelt: "newsletter" }, dann: "frei" },
  { id: "r2", name: "Telekom-Rechnungen", wenn: { domain: "telekom.de", anhangTyp: "application/pdf" }, dann: "beleg" },
  { id: "r3", name: "Steuerberatung", wenn: { absender: "Kanzlei@Example.de" }, dann: "geschaeftsbrief" },
];

describe("vorschlagen", () => {
  it("nimmt die erste Regel, deren Bedingungen alle zutreffen", () => {
    expect(
      vorschlagen(regeln, {
        absender: "rechnung@telekom.de",
        betreff: "Ihre Rechnung",
        anhangTypen: ["application/pdf"],
      }),
    ).toEqual({ art: "beleg", regel: { id: "r2", name: "Telekom-Rechnungen" } });
    expect(
      vorschlagen(regeln, {
        absender: "rechnung@telekom.de",
        betreff: "Newsletter November",
        anhangTypen: ["application/pdf"],
      })?.regel.id,
    ).toBe("r1");
  });

  it("trifft Subdomains, aber keine Domains, die nur gleich enden", () => {
    const m = { betreff: "", anhangTypen: ["application/pdf"] };
    expect(vorschlagen(regeln, { ...m, absender: "x@rechnung.telekom.de" })?.art).toBe("beleg");
    expect(vorschlagen(regeln, { ...m, absender: "x@nichttelekom.de" })).toBeNull();
  });

  it("verlangt alle Bedingungen einer Regel", () => {
    expect(vorschlagen(regeln, { absender: "rechnung@telekom.de", betreff: "", anhangTypen: [] })).toBeNull();
  });

  it("vergleicht Adressen ohne Groß- und Kleinschreibung", () => {
    expect(vorschlagen(regeln, { absender: "kanzlei@example.de", betreff: "", anhangTypen: [] })?.art).toBe(
      "geschaeftsbrief",
    );
  });

  it("lässt eine Regel ohne Bedingung nichts treffen", () => {
    expect(
      vorschlagen([{ id: "leer", name: "leer", wenn: {}, dann: "frei" }], {
        absender: "a@b.de",
        betreff: "",
        anhangTypen: [],
      }),
    ).toBeNull();
  });
});
