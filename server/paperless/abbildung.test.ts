import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  centAusPaperless,
  feldAbbilden,
  notizText,
  type PaperlessFeld,
  pruefsummePasst,
  tagAus,
  wertAbbilden,
} from "./abbildung.ts";

const feld = (typ: string, extra: Partial<PaperlessFeld> = {}): PaperlessFeld => ({
  id: 1,
  name: "Feld",
  typ,
  optionen: [],
  waehrung: null,
  ...extra,
});

describe("Feldtypen", () => {
  it("bildet jeden Typ aus Paperless-ngx ab", () => {
    expect(feldAbbilden(feld("string")).typ).toBe("text");
    expect(feldAbbilden(feld("longtext")).typ).toBe("text");
    expect(feldAbbilden(feld("integer")).typ).toBe("zahl");
    expect(feldAbbilden(feld("monetary")).typ).toBe("betrag");
    expect(feldAbbilden(feld("date")).typ).toBe("datum");
    expect(feldAbbilden(feld("boolean")).typ).toBe("ja_nein");
    expect(feldAbbilden(feld("url")).typ).toBe("link");
    const auswahl = feldAbbilden(
      feld("select", {
        optionen: [
          { id: "a1", label: "Offen" },
          { id: "b2", label: "Bezahlt" },
        ],
      }),
    );
    expect(auswahl).toEqual({ typ: "auswahl", optionen: ["Offen", "Bezahlt"], hinweis: null });
  });

  it("macht unbekannte Typen, Kommazahlen und Verweise zu Text mit Hinweis", () => {
    for (const typ of ["float", "documentlink", "neuer_typ"]) {
      const a = feldAbbilden(feld(typ));
      expect(a.typ).toBe("text");
      expect(a.hinweis).toContain("Feld „Feld“");
    }
  });

  it("nimmt Text statt Auswahl, wenn die Optionen nicht in Belegt passen", () => {
    const doppelt = feldAbbilden(
      feld("select", {
        optionen: [
          { id: "1", label: "A" },
          { id: "2", label: "a" },
        ],
      }),
    );
    expect(doppelt.typ).toBe("text");
    const viele = Array.from({ length: 51 }, (_, i) => ({ id: String(i), label: `O${i}` }));
    expect(feldAbbilden(feld("select", { optionen: viele })).typ).toBe("text");
  });
});

describe("Betrag aus Paperless-ngx", () => {
  it("liest „EUR12.50“ und ältere Zahlen als ganze Cent", () => {
    expect(centAusPaperless("EUR12.50", null)).toEqual({ cent: 1250 });
    expect(centAusPaperless("EUR-3.1", null)).toEqual({ cent: -310 });
    expect(centAusPaperless("12.5", null)).toEqual({ cent: 1250 });
    expect(centAusPaperless("1234", null)).toEqual({ cent: 123400 });
    expect(centAusPaperless(0.1, null)).toEqual({ cent: 10 });
    expect(centAusPaperless("EUR0.07", null)).toEqual({ cent: 7 });
    expect(centAusPaperless("EUR-0.00", null)).toEqual({ cent: 0 });
  });

  it("rechnet nicht mit Fließkommazahlen", () => {
    // 1.15 * 100 wäre als Fließkommazahl 114.99999999999999
    expect(centAusPaperless("EUR1.15", null)).toEqual({ cent: 115 });
    expect(centAusPaperless("EUR9999999999.99", null)).toEqual({ cent: 999999999999 });
  });

  it("nimmt ohne Währungscode die Vorgabe des Feldes und lehnt andere Währungen ab", () => {
    expect(centAusPaperless("12.00", "EUR")).toEqual({ cent: 1200 });
    expect(centAusPaperless("12.00", "USD")).toHaveProperty("grund");
    expect(centAusPaperless("GBP123.45", null)).toEqual({ grund: "andere Währung als Euro: GBP123.45" });
    expect(centAusPaperless("12,50", null)).toHaveProperty("grund");
    expect(centAusPaperless("EUR12.505", null)).toHaveProperty("grund");
  });
});

describe("Werte", () => {
  it("bildet Werte auf den Typ in Belegt ab", () => {
    expect(wertAbbilden(feld("monetary"), "betrag", "EUR12.50")).toEqual({ wert: 1250 });
    expect(wertAbbilden(feld("integer"), "zahl", 42)).toEqual({ wert: 42 });
    expect(wertAbbilden(feld("boolean"), "ja_nein", false)).toEqual({ wert: false });
    expect(wertAbbilden(feld("date"), "datum", "2026-02-28")).toEqual({ wert: "2026-02-28" });
    expect(wertAbbilden(feld("url"), "link", "https://example.org/a")).toEqual({ wert: "https://example.org/a" });
    expect(wertAbbilden(feld("float"), "text", 12.5)).toEqual({ wert: "12.5" });
    expect(wertAbbilden(feld("documentlink"), "text", [3, 7])).toEqual({ wert: "Paperless-ngx: 3, 7" });
    expect(wertAbbilden(feld("string"), "text", null)).toBeNull();
  });

  it("findet die Option einer Auswahl über ihre ID oder, bei älteren Versionen, ihren Index", () => {
    const neu = feld("select", { optionen: [{ id: "x1", label: "Offen" }] });
    expect(wertAbbilden(neu, "auswahl", "x1")).toEqual({ wert: "Offen" });
    const alt = feld("select", {
      optionen: [
        { id: "0", label: "Offen" },
        { id: "1", label: "Bezahlt" },
      ],
    });
    expect(wertAbbilden(alt, "auswahl", 1)).toEqual({ wert: "Bezahlt" });
    expect(wertAbbilden(alt, "auswahl", 9)).toEqual({ notiz: "Feld: 9 (unbekannte Option)" });
  });

  it("legt in die Notiz, was nicht passt", () => {
    expect(wertAbbilden(feld("monetary"), "betrag", "USD5.00")).toEqual({
      notiz: "Feld: USD5.00 (andere Währung als Euro: USD5.00)",
    });
    expect(wertAbbilden(feld("longtext"), "text", "x".repeat(1001))).toHaveProperty("notiz");
  });
});

describe("Hilfen", () => {
  it("liest den Tag der Entstehung aus Datum oder Zeitpunkt", () => {
    expect(tagAus("2026-03-01")).toBe("2026-03-01");
    expect(tagAus("2026-02-30")).toBeNull();
    // 23:30 UTC ist in Deutschland schon der nächste Tag
    expect(tagAus("2026-03-01T23:30:00Z")).toBe("2026-03-02");
    expect(tagAus(null)).toBeNull();
  });

  it("prüft MD5 (ältere Versionen) und SHA-256", () => {
    const bytes = new TextEncoder().encode("Original");
    expect(pruefsummePasst(bytes, createHash("md5").update(bytes).digest("hex"))).toBe(true);
    expect(pruefsummePasst(bytes, createHash("sha256").update(bytes).digest("hex").toUpperCase())).toBe(true);
    expect(pruefsummePasst(bytes, createHash("md5").update("anders").digest("hex"))).toBe(false);
    expect(pruefsummePasst(bytes, "abc")).toBe(false);
  });

  it("vermerkt Autor und Zeit einer Notiz und kürzt auf 5000 Zeichen", () => {
    expect(notizText(" Bitte prüfen ", "anna", "2026-01-02T10:00:00Z")).toBe(
      "Bitte prüfen\n\n(Paperless-ngx: anna, 2026-01-02T10:00:00Z)",
    );
    const lang = notizText("y".repeat(6000), null, null);
    expect(lang.length).toBe(5000);
    expect(lang).toContain("…\n\n(Paperless-ngx: unbekannt)");
  });
});
