import { describe, expect, it } from "vitest";
import {
  ansichtAus,
  ansichtSuche,
  ansichtZuParametern,
  LEERE_ANSICHT,
  parameterNormalisieren,
} from "./archivansicht.ts";

const TAG_A = "11111111-1111-4111-8111-111111111111";
const TAG_B = "22222222-2222-4222-8222-222222222222";
const FELD = "33333333-3333-4333-8333-333333333333";

describe("Ansicht des Archivs als URL", () => {
  it("ohne Parameter ist alles Vorgabe, und die Vorgabe ergibt keine Parameter", () => {
    expect(ansichtAus({})).toEqual(LEERE_ANSICHT);
    expect(ansichtZuParametern(LEERE_ANSICHT)).toEqual({});
    expect(ansichtSuche(LEERE_ANSICHT)).toBe("");
  });

  it("hin und zurück bleibt jede Angabe erhalten", () => {
    const ansicht = {
      ...LEERE_ANSICHT,
      suche: "Strom 2026",
      gruppe: "pflicht" as const,
      tags: [TAG_A, TAG_B],
      tagModus: "einer" as const,
      dokumenttyp: "ohne",
      feld: { feldId: FELD, art: "bereich" as const, text: "", von: "10,00", bis: "1.234,56" },
      sortierung: "frist" as const,
      darstellung: "kacheln" as const,
      proSeite: 100,
    };
    const parameter = ansichtZuParametern(ansicht);
    expect(parameter).toEqual({
      suche: "Strom 2026",
      gruppe: "pflicht",
      tags: `${TAG_A},${TAG_B}`,
      tagModus: "einer",
      dokumenttyp: "ohne",
      feld: FELD,
      feldArt: "bereich",
      feldVon: "10,00",
      feldBis: "1.234,56",
      sortierung: "frist",
      darstellung: "kacheln",
      proSeite: "100",
    });
    expect(ansichtAus(parameter)).toEqual(ansicht);
    // Über eine echte Adresse
    const suche = new URLSearchParams(ansichtSuche(ansicht));
    expect(ansichtAus(Object.fromEntries(suche))).toEqual(ansicht);
  });

  it("Ungültiges fällt auf die Vorgabe zurück, doppelte Tags fallen weg", () => {
    const a = ansichtAus({
      gruppe: "irgendwas",
      tags: `${TAG_A},kein-tag,${TAG_A.toUpperCase()}`,
      tagModus: "einer",
      dokumenttyp: "x",
      feld: "kein-feld",
      sortierung: "zufall",
      darstellung: "riesig",
      proSeite: "7",
    });
    expect(a).toEqual({ ...LEERE_ANSICHT, tags: [TAG_A] });
    // Der Modus zählt erst ab zwei Tags
    expect(ansichtZuParametern(a)).toEqual({ tags: TAG_A });
  });

  it("ein Feldfilter behält nur, was zu seiner Art gehört", () => {
    expect(parameterNormalisieren({ feld: FELD, feldArt: "enthaelt", feldText: " Vertrag ", feldVon: "1" })).toEqual({
      feld: FELD,
      feldArt: "enthaelt",
      feldText: "Vertrag",
    });
    expect(parameterNormalisieren({ feld: FELD, feldText: "weg" })).toEqual({ feld: FELD });
  });

  it("unbekannte Parameter verschwinden beim Normalisieren", () => {
    expect(parameterNormalisieren({ suche: " a ", fremd: "x", seite: "3" })).toEqual({ suche: "a" });
  });
});
