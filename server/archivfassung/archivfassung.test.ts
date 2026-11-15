import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFRawStream, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { ausfuehren, ocrVerfuegbar } from "../inhalt/ocr.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { archivfassungenErzeugen, archivfassungImKind } from "./archivfassung.ts";
import { bildMasse } from "./bildmasse.ts";
import { archivPdf } from "./erzeugen.ts";
import { srgbProfil } from "./icc.ts";

const TEXT = "Stromrechnung Oktober Müller";

async function pdfMit(texte: string[], groesse: [number, number] = [600, 300]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of texte) doc.addPage(groesse).drawText(t, { x: 40, y: groesse[1] / 2, font, size: 32 });
  return new Uint8Array(await doc.save());
}

/** Ein „Scan“: PDF mit Text, als PNG oder JPEG gerastert wie aus einem Scanner */
async function scan(text: string, art: "png" | "jpeg" = "png"): Promise<Uint8Array> {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-scan-"));
  try {
    await writeFile(join(ordner, "a.pdf"), await pdfMit([text]));
    await ausfuehren("pdftoppm", ["-r", "200", `-${art}`, "-singlefile", join(ordner, "a.pdf"), join(ordner, "a")]);
    return new Uint8Array(await readFile(join(ordner, art === "png" ? "a.png" : "a.jpg")));
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

/** Ein gescanntes PDF: je Seite nur ein Bild, keine Textebene */
async function scanPdf(bilder: Uint8Array[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const png of bilder) {
    const bild = await doc.embedPng(png);
    doc.addPage([bild.width * 0.36, bild.height * 0.36]).drawImage(bild, {
      x: 0,
      y: 0,
      width: bild.width * 0.36,
      height: bild.height * 0.36,
    });
  }
  return new Uint8Array(await doc.save());
}

async function seitenTexte(pdf: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  try {
    return (await extractText(doc, { mergePages: false })).text as string[];
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Was PDF/A-2b verlangt und sich ohne veraPDF prüfen lässt (ISO 19005-2 6.1.3, 6.2.3, 6.6.2.1, 6.2.11.4) */
async function pdfaPruefen(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const { catalog, context } = pdf;
  const intents = catalog.lookup(PDFName.of("OutputIntents"), PDFArray);
  const intent = intents.lookup(0, PDFDict);
  expect(intent.get(PDFName.of("S"))).toBe(PDFName.of("GTS_PDFA1"));
  const profil = intent.lookup(PDFName.of("DestOutputProfile")) as PDFRawStream;
  expect(profil.dict.get(PDFName.of("N"))?.toString()).toBe("3");

  const metadaten = catalog.lookup(PDFName.of("Metadata")) as PDFRawStream;
  expect(metadaten.dict.get(PDFName.of("Filter"))).toBeUndefined();
  const xmp = new TextDecoder().decode(metadaten.contents);
  expect(xmp).toContain("<pdfaid:part>2</pdfaid:part>");
  expect(xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
  const datum = /<xmp:CreateDate>(.+?)<\/xmp:CreateDate>/.exec(xmp)![1]!;
  expect(pdf.getCreationDate()?.toISOString().replace(".000", "")).toBe(datum);
  expect(pdf.getProducer()).toBe(/<pdf:Producer>(.+?)<\/pdf:Producer>/.exec(xmp)![1]);

  expect(context.trailerInfo.ID).toBeDefined();
  // Die Schrift der Textebene (GlyphLessFont von Tesseract) ist eingebettet
  const schriften = context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("FontDescriptor"));
  expect(schriften.length).toBeGreaterThan(0);
  for (const s of schriften) expect(s.get(PDFName.of("FontFile2"))).toBeDefined();
}

describe("Bildmaße und Farbprofil", () => {
  it("liest Breite und Höhe aus PNG, JPEG und WebP, ohne das Bild zu entpacken", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 100_000);
    new DataView(png.buffer).setUint32(20, 70_000);
    expect(bildMasse(png)).toEqual({ breite: 100_000, hoehe: 70_000 });

    // SOI, APP0 mit 16 Bytes, SOF2 (progressiv) 600 × 400
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      16,
      ...new Array(14).fill(0),
      0xff,
      0xc2,
      0,
      11,
      8,
      0x01,
      0x90,
      0x02,
      0x58,
      1,
      0,
      0,
    ]);
    expect(bildMasse(jpeg)).toEqual({ breite: 600, hoehe: 400 });

    const riff = (art: string, daten: number[]) =>
      new Uint8Array(
        [..."RIFF"]
          .map((c) => c.charCodeAt(0))
          .concat(
            [0, 0, 0, 0],
            [...`WEBP${art}`].map((c) => c.charCodeAt(0)),
            daten,
          ),
      );
    // VP8X: Breite und Höhe minus 1 als 24 Bit
    const vp8x = riff("VP8X", [10, 0, 0, 0, 0, 0, 0, 0, 0x3f, 0x42, 0x0f, 0x3f, 0x42, 0x0f, 0, 0]);
    expect(bildMasse(vp8x)).toEqual({ breite: 1_000_000, hoehe: 1_000_000 });
    // VP8L: Signatur 0x2f, dann je 14 Bit Breite und Höhe minus 1
    const bits = 1999 | (2999 << 14);
    const vp8l = riff("VP8L", [
      0,
      0,
      0,
      0,
      0x2f,
      bits & 255,
      (bits >> 8) & 255,
      (bits >> 16) & 255,
      (bits >>> 24) & 255,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(bildMasse(vp8l)).toEqual({ breite: 2000, hoehe: 3000 });
    expect(bildMasse(new TextEncoder().encode("kein Bild"))).toBeNull();
  });

  it("schreibt ein sRGB-Profil nach ICC v2 (Monitor, RGB, XYZ)", () => {
    const p = srgbProfil();
    const kopf = new TextDecoder().decode(p.subarray(12, 24));
    expect(kopf).toBe("mntrRGB XYZ ");
    expect(new TextDecoder().decode(p.subarray(36, 40))).toBe("acsp");
    expect(new DataView(p.buffer, p.byteOffset).getUint32(0)).toBe(p.byteLength);
    expect(p[8]).toBe(2);
  });
});

// Tesseract braucht je Seite einige Sekunden, neben den anderen Tests auch mehr
describe.skipIf(!ocrVerfuegbar())("Archivfassung (Tesseract)", { timeout: 120_000 }, () => {
  let png: Uint8Array;
  beforeAll(async () => {
    png = await scan(TEXT);
  });

  it("macht aus einem Bild ein PDF/A-2b mit lesbarem Text", async () => {
    const { pdf, seiten } = await archivPdf(png, "image/png");
    expect(seiten).toBe(1);
    expect((await seitenTexte(pdf))[0]).toContain(TEXT);
    await pdfaPruefen(pdf);
  });

  it("bettet ein JPEG ein und macht aus einem gescannten PDF eins mit gleich vielen Seiten", async () => {
    const jpeg = await archivPdf(await scan(TEXT, "jpeg"), "image/jpeg");
    expect((await seitenTexte(jpeg.pdf))[0]).toContain(TEXT);

    const pdf = await scanPdf([png, await scan("Zweite Seite Kassenbon")]);
    const fassung = await archivPdf(pdf, "application/pdf");
    expect(fassung.seiten).toBe(2);
    const texte = await seitenTexte(fassung.pdf);
    expect(texte[0]).toContain(TEXT);
    expect(texte[1]).toContain("Kassenbon");
    await pdfaPruefen(fassung.pdf);
  });

  it("lehnt zu viele Seiten, riesige Seiten und riesige Bilder ab, bevor etwas gerastert wird", async () => {
    const start = Date.now();
    await expect(archivPdf(await pdfMit(new Array(51).fill("Seite")), "application/pdf")).rejects.toThrow(
      "Zu viele Seiten (51, höchstens 50)",
    );
    await expect(archivPdf(await pdfMit(["Plakat"], [14400, 14400]), "application/pdf")).rejects.toThrow(
      "Seite 1 zu groß",
    );
    const riesig = new Uint8Array(png);
    new DataView(riesig.buffer).setUint32(16, 100_000);
    new DataView(riesig.buffer).setUint32(20, 100_000);
    await expect(archivPdf(riesig, "image/png")).rejects.toThrow("Bild zu groß (100000 × 100000 Bildpunkte)");
    await expect(archivPdf(new TextEncoder().encode("kein Bild"), "image/png")).rejects.toThrow("nicht lesbar");
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it("rastert die Seite, deren Größe es geprüft hat: den Beschnitt, nicht einen größeren Medienrahmen", async () => {
    // pdfinfo nennt die Größe des Beschnitts (CropBox); rasterte pdftoppm den Medienrahmen (MediaBox), käme ein
    // Plakat mit 14400 pt Medienrahmen und kleinem Beschnitt an der Grenze vorbei (hier klein, damit der Test schnell ist)
    const doc = await PDFDocument.load(await pdfMit(["Beschnitt"], [600, 600]));
    doc.getPage(0).setCropBox(0, 0, 300, 300);
    const { pdf } = await archivPdf(new Uint8Array(await doc.save()), "application/pdf");
    const { width, height } = (await PDFDocument.load(pdf)).getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([300, 300]);
  });

  it("beendet das Kind mit allen Programmen nach dem Zeitlimit und meldet Fehler als Wert", async () => {
    await expect(archivfassungImKind(png, "image/png", 300)).rejects.toThrow("abgebrochen");
    await expect(archivfassungImKind(png, "text/plain")).rejects.toThrow("Keine Archivfassung für text/plain");
  });

  describe.skipIf(!testDatenbankUrl)("im Archiv", () => {
    let t: Awaited<ReturnType<typeof testApp>>;
    let cookie: string;
    const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
    const hoch = async (bytes: Uint8Array, name: string) => {
      const f = new FormData();
      f.append("datei", new File([new Uint8Array(bytes)], name));
      return (await (await als("/api/dokumente", { method: "POST", body: f })).json()) as {
        id: string;
        sha256: string;
      };
    };
    /** Wie nach der Texterkennung, ohne sie abzuwarten: Text aus OCR */
    const alsGelesen = (id: string) => t.sql`insert into inhalte (dokument_id, text, ocr) values (${id}, 'Text', true)`;
    beforeAll(async () => {
      t = await testApp();
      cookie = (await t.registrieren("anna@example.org")).cookie;
    });
    afterAll(() => t?.aufraeumen());

    it("erzeugt Fassungen für Scans nach der Texterkennung, keine für PDFs mit Text; das Original bleibt gleich", async () => {
      const bild = await hoch(png, "scan.png");
      const gescannt = await hoch(await scanPdf([png]), "scan.pdf");
      const mitText = await hoch(await pdfMit([TEXT]), "rechnung.pdf");
      // Ein Foto ohne Text: durchsuchbar wäre daran nichts
      const leer = await hoch(await scan(""), "leer.png");

      // Erst nach der Texterkennung, denn sie entscheidet, was ein Scan ist
      expect(await archivfassungenErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });
      expect(await inhalteErzeugen(t, { ocr: true })).toEqual({ gelesen: 4, fehler: 0 });
      expect(await archivfassungenErzeugen(t)).toEqual({ erzeugt: 2, fehler: 0 });
      expect(await archivfassungenErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });

      for (const [d, name] of [
        [bild, "scan (durchsuchbar).pdf"],
        [gescannt, "scan (durchsuchbar).pdf"],
      ] as const) {
        const res = await als(`/api/dokumente/${d.id}/archivfassung`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        const kopf = res.headers.get("content-disposition") ?? "";
        expect(kopf).toMatch(/^inline; filename\*=UTF-8''/);
        expect(decodeURIComponent(kopf.split("''")[1]!)).toBe(name);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        const pdf = new Uint8Array(await res.arrayBuffer());
        expect(await seitenTexte(pdf)).toEqual([expect.stringContaining(TEXT)]);
        expect(await (await als(`/api/dokumente/${d.id}`)).json()).toMatchObject({ archivfassung: true });

        const original = new Uint8Array(await (await als(`/api/dokumente/${d.id}/datei`)).arrayBuffer());
        expect(createHash("sha256").update(original).digest("hex")).toBe(d.sha256);
      }
      expect(
        Buffer.from(await (await als(`/api/dokumente/${bild.id}/datei`)).arrayBuffer()).equals(Buffer.from(png)),
      ).toBe(true);
      expect(await t.sql`select seiten from archivfassungen where dokument_id = ${gescannt.id}`).toEqual([
        { seiten: 1 },
      ]);

      expect((await als(`/api/dokumente/${mitText.id}/archivfassung`)).status).toBe(404);
      expect(await (await als(`/api/dokumente/${mitText.id}`)).json()).toMatchObject({ archivfassung: false });
      expect(await t.sql`select 1 from archivfassungen where dokument_id = ${mitText.id}`).toHaveLength(0);
      expect(await t.sql`select 1 from archivfassungen where dokument_id = ${leer.id}`).toHaveLength(0);
    });

    it("hält fest, was zu groß ist, ohne zu hängen, und wartet, wenn der Speicher fehlt", async () => {
      const viele = await hoch(await pdfMit(new Array(51).fill("Leer")), "stapel.pdf");
      await alsGelesen(viele.id);
      const ohneSpeicher = { db: t.db, speicher: { ...t.speicher, laden: () => Promise.reject(new Error("S3 weg")) } };
      expect(await archivfassungenErzeugen(ohneSpeicher)).toMatchObject({ meldung: "Speicher nicht erreichbar" });
      expect(await t.sql`select 1 from archivfassungen where dokument_id = ${viele.id}`).toHaveLength(0);

      expect(await archivfassungenErzeugen(t)).toEqual({ erzeugt: 0, fehler: 1 });
      expect(await t.sql`select fehler, pdf from archivfassungen where dokument_id = ${viele.id}`).toEqual([
        { fehler: "Zu viele Seiten (51, höchstens 50)", pdf: null },
      ]);
      expect(await archivfassungenErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });
      expect((await als(`/api/dokumente/${viele.id}/archivfassung`)).status).toBe(404);

      const plakat = await hoch(await pdfMit(["Plakat"], [14400, 14400]), "plakat.pdf");
      await alsGelesen(plakat.id);
      expect(await archivfassungenErzeugen(t, { zeitlimit: 30_000 })).toEqual({ erzeugt: 0, fehler: 1 });
      const [z] = await t.sql`select fehler from archivfassungen where dokument_id = ${plakat.id}`;
      expect(z?.fehler).toMatch(/^Seite 1 zu groß/);
    });
  });
});

describe.skipIf(!testDatenbankUrl)("Archivfassungen gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const hoch = async (bytes: Uint8Array, name: string) => {
    const f = new FormData();
    f.append("datei", new File([new Uint8Array(bytes)], name));
    return (await (await als("/api/dokumente", { method: "POST", body: f })).json()) as { id: string; sha256: string };
  };
  const einordnen = (id: string, entstanden = "2026-01-02", art = "frei") =>
    als(`/api/dokumente/${id}/einordnung`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ art, entstanden }),
    });
  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("löscht die Fassung mit dem Dokument und lässt keine nachkommen", async () => {
    const d = await hoch(await pdfMit(["Weg damit"]), "weg.pdf");
    await t.sql`insert into archivfassungen (dokument_id, pdf, seiten) values (${d.id}, ${Buffer.from("%PDF-")}, 1)`;
    expect((await als(`/api/dokumente/${d.id}/archivfassung`)).status).toBe(200);
    await einordnen(d.id);
    expect((await als(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect((await als(`/api/dokumente/${d.id}/archivfassung`)).status).toBe(410);
    expect(await t.sql`select 1 from archivfassungen where dokument_id = ${d.id}`).toHaveLength(0);
    await t.sql`insert into archivfassungen (dokument_id, pdf) values (${d.id}, ${Buffer.from("x")})`;
    expect(await t.sql`select 1 from archivfassungen where dokument_id = ${d.id}`).toHaveLength(0);
    expect(await archivfassungenErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });
  });

  it("löscht die Fassung auch, wenn der Worker sie gerade schreibt, während die Löschung bestätigt wird", async () => {
    const d = await hoch(await pdfMit(["Nebenläufig"]), "nebenlaeufig.pdf");
    await einordnen(d.id);
    let abschliessen = () => {};
    let geschrieben = () => {};
    const istGeschrieben = new Promise<void>((r) => {
      geschrieben = r;
    });
    const worker = t.sql.begin(async (tx) => {
      await tx`insert into archivfassungen (dokument_id, pdf, seiten) values (${d.id}, ${Buffer.from("%PDF-")}, 1)`;
      geschrieben();
      await new Promise<void>((r) => {
        abschliessen = r;
      });
    });
    await istGeschrieben;
    const loeschung = als(`/api/dokumente/${d.id}/loeschung`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 300));
    abschliessen();
    await worker;
    expect((await loeschung).status).toBe(201);
    expect(await t.sql`select 1 from archivfassungen where dokument_id = ${d.id}`).toHaveLength(0);
  });

  it("zeigt Prüfern nur Fassungen ihres Zeitraums und Tokens mit dem Recht lesen", async () => {
    const drin = await hoch(await pdfMit(["Drin"]), "drin.pdf");
    const draussen = await hoch(await pdfMit(["Draußen"]), "draussen.pdf");
    await einordnen(drin.id, "2024-03-01", "beleg");
    await einordnen(draussen.id, "2021-03-01", "beleg");
    for (const d of [drin, draussen])
      await t.sql`insert into archivfassungen (dokument_id, pdf, seiten) values (${d.id}, ${Buffer.from("%PDF-")}, 1)`;
    const pruefer = await zugangAnlegen(t, cookie, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
    expect((await t.anfrage(`/api/dokumente/${drin.id}/archivfassung`, {}, pruefer)).status).toBe(200);
    expect((await t.anfrage(`/api/dokumente/${draussen.id}/archivfassung`, {}, pruefer)).status).toBe(404);
    const token = await tokenAnlegen(t, cookie, "lesen");
    const res = await t.anfrage(`/api/dokumente/${drin.id}/archivfassung`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    // Z3 enthält nur Originale: Die Fassung ist abgeleitet und jederzeit neu erzeugbar, maßgeblich ist das Original
    const zip = unzipSync(new Uint8Array(await (await als("/api/export?von=2024-01-01&bis=2024-12-31")).arrayBuffer()));
    const pdfs = Object.keys(zip).filter((n) => n.endsWith(".pdf"));
    expect(pdfs).toHaveLength(1);
    expect(createHash("sha256").update(zip[pdfs[0]!]!).digest("hex")).toBe(drin.sha256);
    expect(Object.keys(zip).some((n) => n.includes("durchsuchbar"))).toBe(false);
  });
});
