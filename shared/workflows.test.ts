import { describe, expect, it } from "vitest";
import { bedingungenErfuellt, brauchtText, type DokumentMerkmale } from "./workflows.ts";

const TAG = "11111111-1111-4111-8111-111111111111";
const TYP = "22222222-2222-4222-8222-222222222222";

const pdf: DokumentMerkmale = {
  quelle: "upload",
  dateiname: "Rechnung-Strom.pdf",
  mimeType: "application/pdf",
  mail: null,
  text: "Stadtwerke Beispiel, Rechnung Nr. 42",
  tags: [TAG],
  dokumenttyp: null,
  herkunft: "nutzer:anna@example.org",
};
const anhang: DokumentMerkmale = {
  ...pdf,
  quelle: "mail",
  mail: { absender: "rechnung@kunden.telekom.de", betreff: "Ihre Rechnung November", anhangTypen: ["application/pdf"] },
  tags: [],
  herkunft: "system:imap:Büro",
};

describe("Bedingungen eines Workflows", () => {
  it("ohne Bedingung trifft er jedes Dokument", () => {
    expect(bedingungenErfuellt({}, pdf)).toBe(true);
  });

  it("Quelle, Dateiname, Mime-Typ mit Stern, Tag und Dokumenttyp", () => {
    expect(bedingungenErfuellt({ quellen: ["upload", "ordner"] }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ quellen: ["mail"] }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ dateinameEnthaelt: "strom" }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ dateinameEnthaelt: "gas" }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ mimeTyp: "application/pdf" }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ mimeTyp: "image/*" }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ mimeTyp: "application/*" }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ tags: [TAG] }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ tags: [TAG, TYP] }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ dokumenttyp: "ohne" }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ dokumenttyp: TYP }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ dokumenttyp: TYP }, { ...pdf, dokumenttyp: TYP })).toBe(true);
    expect(bedingungenErfuellt({ dokumenttyp: "ohne" }, { ...pdf, dokumenttyp: TYP })).toBe(false);
  });

  it("Text ohne Groß- und Kleinschreibung; ohne gelesenen Text trifft er nicht", () => {
    expect(bedingungenErfuellt({ textEnthaelt: "stadtwerke" }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ textEnthaelt: "Telekom" }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ textEnthaelt: "Stadtwerke" }, { ...pdf, text: null })).toBe(false);
    expect(brauchtText({ textEnthaelt: "x" })).toBe(true);
    expect(brauchtText({ textEnthaelt: "  ", dateinameEnthaelt: "x" })).toBe(false);
  });

  it("Absender, Domain, Betreff und Anhangtyp wie bei den Regeln, auch für den Anhang einer Mail", () => {
    expect(bedingungenErfuellt({ domain: "telekom.de" }, anhang)).toBe(true);
    expect(bedingungenErfuellt({ domain: "telekom.com" }, anhang)).toBe(false);
    expect(bedingungenErfuellt({ absender: "Rechnung@Kunden.Telekom.de" }, anhang)).toBe(true);
    expect(bedingungenErfuellt({ betreffEnthaelt: "rechnung", anhangTyp: "application/pdf" }, anhang)).toBe(true);
    // Ohne Mail ist der Dateiname der Betreff
    expect(bedingungenErfuellt({ betreffEnthaelt: "strom" }, pdf)).toBe(true);
    expect(bedingungenErfuellt({ domain: "telekom.de" }, pdf)).toBe(false);
  });

  it("Postfach und Unterordner aus der Herkunft", () => {
    expect(bedingungenErfuellt({ postfach: "büro" }, anhang)).toBe(true);
    expect(bedingungenErfuellt({ postfach: "Privat" }, anhang)).toBe(false);
    expect(bedingungenErfuellt({ postfach: "Büro" }, pdf)).toBe(false);
    expect(bedingungenErfuellt({ postfach: "Büro" }, { ...anhang, herkunft: "system:jmap:Büro" })).toBe(true);
    const ordner = { ...pdf, quelle: "ordner", herkunft: "system:ordner:Steuer/2026" };
    expect(bedingungenErfuellt({ unterordner: "Steuer" }, ordner)).toBe(true);
    expect(bedingungenErfuellt({ unterordner: "steuer/2026/" }, ordner)).toBe(true);
    expect(bedingungenErfuellt({ unterordner: "Steu" }, ordner)).toBe(false);
    expect(bedingungenErfuellt({ unterordner: "Steuer" }, { ...ordner, herkunft: "system:ordner" })).toBe(false);
    expect(bedingungenErfuellt({ unterordner: "Steuer" }, pdf)).toBe(false);
  });

  it("alle gesetzten Bedingungen müssen zutreffen", () => {
    expect(bedingungenErfuellt({ quellen: ["mail"], domain: "telekom.de", postfach: "Büro" }, anhang)).toBe(true);
    expect(bedingungenErfuellt({ quellen: ["mail"], domain: "telekom.de", postfach: "Privat" }, anhang)).toBe(false);
  });
});
