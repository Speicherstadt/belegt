import { describe, expect, it } from "vitest";
import { type Abgleich, aehnlichkeit, regexGueltig, teilAehnlichkeit, trifft, woerter } from "./abgleich.ts";

const regel = (abgleich: Abgleich["abgleich"], abgleichText: string, grossKleinEgal = true): Abgleich => ({
  abgleich,
  abgleichText,
  grossKleinEgal,
});

describe("Zuordnungsregeln", () => {
  it("teilt Wörter wie Paperless-ngx, Anführungszeichen halten zusammen", () => {
    expect(woerter('  some random  words "with   quotes  " and   spaces')).toEqual([
      "some",
      "random",
      "words",
      "with\\s+quotes",
      "and",
      "spaces",
    ]);
  });

  it("keiner trifft nie, ein leerer Text auch nicht", () => {
    expect(trifft(regel("keiner", "telekom"), "Telekom")).toBe(false);
    expect(trifft(regel("irgendein_wort", "   "), "Telekom")).toBe(false);
  });

  it("irgendein Wort: eines genügt, nur ganze Wörter", () => {
    const r = regel("irgendein_wort", "telekom vodafone");
    expect(trifft(r, "Rechnung der Vodafone GmbH")).toBe(true);
    expect(trifft(r, "Rechnung der Telekomik")).toBe(false);
    expect(trifft(r, "nichts davon")).toBe(false);
  });

  it("alle Wörter: jedes muss vorkommen, in beliebiger Reihenfolge", () => {
    const r = regel("alle_woerter", 'rechnung "Telekom Deutschland"');
    expect(trifft(r, "Telekom   Deutschland GmbH, Ihre Rechnung")).toBe(true);
    expect(trifft(r, "Telekom Deutschland, Ihr Angebot")).toBe(false);
  });

  it("exakt: die ganze Zeichenfolge als Wortgruppe, Sonderzeichen wörtlich", () => {
    const r = regel("exakt", "Muster (GmbH) & Co.");
    expect(trifft(r, "Von Muster (GmbH) & Co. KG")).toBe(true);
    expect(trifft(r, "Von Muster GmbH & Co.")).toBe(false);
    expect(trifft(regel("exakt", "Strom Gas"), "Gas Strom")).toBe(false);
  });

  it("Groß- und Kleinschreibung: Vorgabe ignorieren, sonst genau", () => {
    expect(trifft(regel("irgendein_wort", "TELEKOM"), "telekom")).toBe(true);
    expect(trifft(regel("irgendein_wort", "TELEKOM", false), "telekom")).toBe(false);
    expect(trifft(regel("irgendein_wort", "Telekom", false), "Telekom")).toBe(true);
  });

  it("Umlaute: Wortgrenzen und Groß- und Kleinschreibung auch für ä, ö, ü und ß", () => {
    expect(trifft(regel("irgendein_wort", "MÜLLER"), "Bäckerei müller")).toBe(true);
    // \b in JavaScript sähe vor dem ü eine Wortgrenze; hier nicht
    expect(trifft(regel("irgendein_wort", "M"), "Müller")).toBe(false);
    expect(trifft(regel("exakt", "Straße"), "Hauptstraße 1")).toBe(false);
    expect(trifft(regel("exakt", "Straße"), "Straße 1")).toBe(true);
    expect(trifft(regel("alle_woerter", "Öl Ärger", false), "Öl und Ärger")).toBe(true);
  });

  it("regex und automatisch entscheidet nicht diese Funktion", () => {
    expect(trifft(regel("regex", "tele.*"), "Telekom")).toBeNull();
    expect(trifft(regel("automatisch", ""), "Telekom")).toBeNull();
    expect(regexGueltig("tele(kom|fon)")).toBe(true);
    expect(regexGueltig("tele(kom")).toBe(false);
  });

  it("unscharf: Ähnlichkeit wie rapidfuzz ratio und partial_ratio", () => {
    expect(aehnlichkeit("abc", "abc")).toBe(100);
    expect(aehnlichkeit("abcd", "abce")).toBe(75);
    expect(aehnlichkeit("", "")).toBe(100);
    expect(teilAehnlichkeit("telekom", "ihre telekom rechnung")).toBe(100);
    expect(teilAehnlichkeit("telekom", "ab")).toBeLessThan(50);
    // Am Ende des Texts zählt auch ein kürzeres Stück
    expect(teilAehnlichkeit("mobilfunk vertrag", "ihre mobilfunkvertrag")).toBeGreaterThan(90);
  });

  it("unscharf: ein Tippfehler trifft, ein anderes Wort nicht; Satzzeichen zählen nicht", () => {
    const r = regel("unscharf", "Telekom Deutschland");
    expect(trifft(r, "Rechnung der Telekon Deutschland GmbH")).toBe(true);
    expect(trifft(r, "Rechnung der TELEKOM-DEUTSCHLAND GmbH")).toBe(true);
    expect(trifft(r, "Rechnung der Stadtwerke Musterstadt")).toBe(false);
    expect(trifft(regel("unscharf", "Telekom Deutschland", false), "telekom deutschland")).toBe(false);
    expect(trifft(regel("unscharf", "Müller Bäckerei"), "Mueller Baeckerei")).toBe(false);
    expect(trifft(regel("unscharf", "Müller Bäckerei"), "Mülller Bäckerei")).toBe(true);
  });

  it("unscharf: bleibt schnell bei langem Muster und langem Text, und trifft am Anfang des Texts", () => {
    // Ein Muster aus der Zeit vor der Grenze (500 Zeichen) gegen einen Text mit 25 000 Wortanfängen
    const lang = regel("unscharf", "ab ".repeat(166));
    const start = performance.now();
    expect(trifft(lang, "x ".repeat(25_000))).toBe(false);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(trifft(regel("unscharf", "Telekom Deutschland"), `Telekon Deutschland ${"x ".repeat(25_000)}`)).toBe(true);
  });
});
