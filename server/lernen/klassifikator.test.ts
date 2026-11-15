import { describe, expect, it } from "vitest";
import { type Beispiel, lernen, MINDESTMENGE, SCHWELLE, vorhersagen, woerterAus } from "./klassifikator.ts";

const FUELL =
  "Sehr geehrte Damen und Herren, anbei erhalten Sie Ihre Unterlagen. Mit freundlichen Grüßen, Kundenservice";
const GRUPPEN = [
  {
    k: "telekom",
    art: "beleg",
    typ: "rechnung",
    text: "Telekom Deutschland Mobilfunk Rechnung Tarif Magenta Kundennummer",
  },
  {
    k: "stadtwerke",
    art: "beleg",
    typ: "rechnung",
    text: "Stadtwerke Musterstadt Abschlag Strom Gas Zählerstand Verbrauch",
  },
  {
    k: "allianz",
    art: "freiwillig",
    typ: null,
    text: "Allianz Versicherung Police Beitrag Haftpflicht Versicherungsschein",
  },
];

/** je Gruppe n Dokumente; jedes lässt ein anderes Viertel seiner Wörter weg */
function beispiele(n: number): Beispiel[] {
  return Array.from({ length: n }).flatMap((_, i) =>
    GRUPPEN.map((g) => ({
      woerter: woerterAus(
        `${g.text
          .split(" ")
          .filter((_, j) => (i + j) % 4 !== 0)
          .join(" ")} ${FUELL} Nr${i}${g.k}`,
      ),
      art: g.art,
      korrespondent: g.k,
      dokumenttyp: g.typ,
      tags: g.k === "telekom" ? ["handy"] : [],
    })),
  );
}

describe("Klassifikator", () => {
  it("liest Wörter klein, ohne Füllwörter und reine Zahlen, jedes einmal, mit Umlauten", () => {
    expect(woerterAus("Die Rechnung 2026 der MÜLLER GmbH, Rechnung r2 x")).toEqual([
      "rechnung",
      "müller",
      "gmbh",
      "r2",
    ]);
  });

  it("lernt Korrespondent, Art, Dokumenttyp und Tags aus Beispielen und erklärt den Vorschlag", () => {
    const m = lernen(beispiele(6))!;
    const v = vorhersagen(m, woerterAus(`Ihre Telekom Mobilfunk Rechnung für März. ${FUELL}`));
    expect(v.korrespondent).toMatchObject({ wert: "telekom", anzahl: 6 });
    expect(v.korrespondent!.sicherheit).toBeGreaterThanOrEqual(SCHWELLE);
    expect(v.korrespondent!.woerter).toEqual(expect.arrayContaining(["telekom", "mobilfunk"]));
    expect(v.art).toMatchObject({ wert: "beleg", anzahl: 12 });
    expect(v.dokumenttyp).toMatchObject({ wert: "rechnung" });
    expect(v.tags.map((t) => t.wert)).toEqual(["handy"]);

    const a = vorhersagen(m, woerterAus("Allianz Police, Beitrag für die Haftpflicht"));
    expect(a.korrespondent?.wert).toBe("allianz");
    expect(a.art?.wert).toBe("freiwillig");
    // Allianz-Dokumente haben keinen Dokumenttyp: der Rest gewinnt, also kein Vorschlag
    expect(a.dokumenttyp).toBeNull();
    expect(a.tags).toEqual([]);
  });

  it("schlägt unter der Schwelle nichts vor: nur Füllwörter oder von allem etwas", () => {
    const m = lernen(beispiele(6))!;
    expect(vorhersagen(m, woerterAus(FUELL))).toEqual({ art: null, korrespondent: null, dokumenttyp: null, tags: [] });
    expect(vorhersagen(m, woerterAus("Telekom Stadtwerke Allianz")).korrespondent).toBeNull();
    expect(vorhersagen(m, [])).toEqual({ art: null, korrespondent: null, dokumenttyp: null, tags: [] });
  });

  it("lernt nichts unter der Mindestmenge, und eine Klasse braucht drei Beispiele", () => {
    expect(lernen(beispiele(3).slice(0, MINDESTMENGE - 1))).toBeNull();
    const m = lernen([
      ...beispiele(4),
      ...Array.from({ length: 2 }, () => ({
        woerter: woerterAus("Finanzamt Steuerbescheid Einkommensteuer"),
        art: "sonstige",
        korrespondent: "finanzamt",
        dokumenttyp: null,
        tags: [],
      })),
    ])!;
    expect(m.ziele.korrespondent.map((k) => k.wert)).toEqual(["allianz", "stadtwerke", "telekom"]);
    expect(vorhersagen(m, woerterAus("Finanzamt Steuerbescheid Einkommensteuer")).korrespondent).toBeNull();
  });

  it("Dokumente ohne Korrespondenten zählen als Rest, nicht als eigene Klasse", () => {
    const m = lernen(beispiele(4).map((b) => (b.korrespondent === "allianz" ? { ...b, korrespondent: null } : b)))!;
    expect(m.ziele.korrespondent.map((k) => k.wert)).toEqual(["stadtwerke", "telekom"]);
    expect(vorhersagen(m, woerterAus("Allianz Police Beitrag Haftpflicht")).korrespondent).toBeNull();
  });

  it("ein Wort aus nur einem Dokument kommt nicht in den Wortschatz", () => {
    const m = lernen(beispiele(4))!;
    expect(m.wortschatz).not.toContain("nr1telekom");
    expect(m.wortschatz).toContain("telekom");
  });
});
