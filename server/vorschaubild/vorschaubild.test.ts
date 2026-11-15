import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ansichtenErzeugen } from "../ansicht/ansicht.ts";
import { ausfuehren } from "../inhalt/ocr.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { bildAlsPdf, rasterVerfuegbar, seiteAlsJpeg, seitenzahl, vorschaubild } from "./raster.ts";
import { vorschaubilderErzeugen } from "./vorschaubild.ts";

async function pdfMit(text: string, seiten = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= seiten; i++) doc.addPage().drawText(`${text} ${i}`, { x: 50, y: 700, size: 14, font });
  return new Uint8Array(await doc.save());
}

/** Ein PNG, gerastert aus einem PDF (pdftoppm), damit der Test keine Bildbibliothek braucht */
async function png(text: string) {
  const ordner = await mkdtemp(join(tmpdir(), "belegt-png-"));
  try {
    await writeFile(join(ordner, "d.pdf"), await pdfMit(text));
    await ausfuehren("pdftoppm", ["-r", "50", "-png", "-singlefile", join(ordner, "d.pdf"), join(ordner, "b")]);
    return new Uint8Array(await readFile(join(ordner, "b.png")));
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

/** Breite und Höhe aus dem SOF-Marker eines JPEG */
function jpegMasse(b: Uint8Array): { breite: number; hoehe: number } {
  expect([b[0], b[1]]).toEqual([0xff, 0xd8]);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1]!;
    const laenge = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xc2)
      return { hoehe: (b[i + 5]! << 8) | b[i + 6]!, breite: (b[i + 7]! << 8) | b[i + 8]! };
    i += 2 + laenge;
  }
  throw new Error("Kein SOF");
}

describe.skipIf(!rasterVerfuegbar())("Seiten als Bild", { timeout: 30_000 }, () => {
  it("rastert eine Seite 300 px breit im Seitenverhältnis und zählt Seiten", async () => {
    const pdf = await pdfMit("Rechnung", 3);
    const { breite, hoehe } = jpegMasse(await seiteAlsJpeg(pdf, { seite: 2 }));
    expect(breite).toBe(300);
    // A4 in pdf-lib: 595,28 × 841,89 pt
    expect(hoehe).toBeGreaterThan(420);
    expect(hoehe).toBeLessThan(430);
    expect(await seitenzahl(pdf)).toBe(3);
    await expect(seitenzahl(strToU8("kein pdf"))).rejects.toThrow();
  });

  it("verkleinert JPEG und PNG über ein PDF in Bildgröße", async () => {
    const bild = await png("Quittung");
    const pdf = await PDFDocument.load(await bildAlsPdf(bild, "image/png"));
    expect(pdf.getPageCount()).toBe(1);
    const jpeg = await vorschaubild(bild, "image/png");
    expect(jpegMasse(jpeg).breite).toBe(300);
    expect(jpegMasse(await vorschaubild(jpeg, "image/jpeg")).breite).toBe(300);
    await expect(vorschaubild(strToU8("RIFF....WEBP"), "image/webp")).rejects.toThrow("Kein Vorschaubild");
  });
});

describe.skipIf(!testDatenbankUrl || !rasterVerfuegbar())("Vorschaubilder gegen Postgres", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const hoch = async (bytes: Uint8Array, name: string) => {
    const f = new FormData();
    f.append("datei", new File([new Uint8Array(bytes)], name));
    return (await (await als("/api/dokumente", { method: "POST", body: f })).json()) as {
      id: string;
      mimeType: string;
    };
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

  it("erzeugt Bilder für PDF, PNG und Office mit Ansicht, keins für Mail und Text", async () => {
    const pdf = await hoch(await pdfMit("Rechnung"), "rechnung.pdf");
    const bild = await hoch(await png("Kassenbon"), "bon.png");
    const docx = await hoch(
      zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<w:document/>") }),
      "brief.docx",
    );
    const text = await hoch(strToU8("nur Text"), "notiz.txt");
    const mail = await hoch(strToU8("From: a@example.org\r\nSubject: Hallo\r\n\r\nText"), "mail.eml");

    // Office wartet auf seine Ansicht
    expect(await vorschaubilderErzeugen(t)).toEqual({ erzeugt: 2, fehler: 0 });
    const ansicht = await pdfMit("Ansicht des Briefs");
    await ansichtenErzeugen(t, "http://vorschau", { abfragen: async () => new Response(ansicht) });
    expect(await vorschaubilderErzeugen(t)).toEqual({ erzeugt: 1, fehler: 0 });
    expect(await vorschaubilderErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });

    for (const d of [pdf, bild, docx]) {
      const res = await als(`/api/dokumente/${d.id}/vorschaubild`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(jpegMasse(new Uint8Array(await res.arrayBuffer())).breite).toBe(300);
    }
    for (const d of [text, mail]) expect((await als(`/api/dokumente/${d.id}/vorschaubild`)).status).toBe(404);

    const liste = (await (await als("/api/dokumente")).json()) as { id: string; vorschaubild: boolean }[];
    const hat = Object.fromEntries(liste.map((e) => [e.id, e.vorschaubild]));
    expect([hat[pdf.id], hat[bild.id], hat[docx.id], hat[text.id], hat[mail.id]]).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("hält fest, was sich nicht rastern lässt, und wartet, wenn der Speicher fehlt", async () => {
    const kaputt = await hoch(strToU8("%PDF-1.4\nkaputt"), "kaputt.pdf");
    const ohneSpeicher = { db: t.db, speicher: { ...t.speicher, laden: () => Promise.reject(new Error("S3 weg")) } };
    expect(await vorschaubilderErzeugen(ohneSpeicher)).toMatchObject({ meldung: "Speicher nicht erreichbar" });
    expect(await t.sql`select 1 from vorschaubilder where dokument_id = ${kaputt.id}`).toHaveLength(0);
    expect(await vorschaubilderErzeugen(t)).toEqual({ erzeugt: 0, fehler: 1 });
    expect(await vorschaubilderErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });
    expect((await als(`/api/dokumente/${kaputt.id}/vorschaubild`)).status).toBe(404);
  });

  it("löscht das Vorschaubild mit dem Dokument und lässt keins nachkommen", async () => {
    const d = await hoch(await pdfMit("Weg damit"), "weg.pdf");
    await vorschaubilderErzeugen(t);
    expect((await als(`/api/dokumente/${d.id}/vorschaubild`)).status).toBe(200);
    await einordnen(d.id);
    expect((await als(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect((await als(`/api/dokumente/${d.id}/vorschaubild`)).status).toBe(410);
    expect(await t.sql`select 1 from vorschaubilder where dokument_id = ${d.id}`).toHaveLength(0);
    await t.sql`insert into vorschaubilder (dokument_id, bild) values (${d.id}, ${Buffer.from("x")})`;
    expect(await t.sql`select 1 from vorschaubilder where dokument_id = ${d.id}`).toHaveLength(0);
    expect(await vorschaubilderErzeugen(t)).toEqual({ erzeugt: 0, fehler: 0 });
  });

  it("löscht das Vorschaubild auch, wenn der Worker es gerade schreibt, während die Löschung bestätigt wird", async () => {
    const d = await hoch(await pdfMit("Nebenläufig"), "nebenlaeufig.pdf");
    await einordnen(d.id);
    let abschliessen = () => {};
    let geschrieben = () => {};
    const istGeschrieben = new Promise<void>((r) => {
      geschrieben = r;
    });
    const worker = t.sql.begin(async (tx) => {
      await tx`insert into vorschaubilder (dokument_id, bild) values (${d.id}, ${Buffer.from("jpeg")})`;
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
    expect(await t.sql`select 1 from vorschaubilder where dokument_id = ${d.id}`).toHaveLength(0);
  });

  it("zeigt Prüfern nur Bilder ihres Zeitraums und Tokens mit dem Recht lesen", async () => {
    const drin = await hoch(await pdfMit("Drin"), "drin.pdf");
    const draussen = await hoch(await pdfMit("Draußen"), "draussen.pdf");
    await einordnen(drin.id, "2024-03-01", "beleg");
    await einordnen(draussen.id, "2021-03-01", "beleg");
    await vorschaubilderErzeugen(t);
    const pruefer = await zugangAnlegen(t, cookie, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
    expect((await t.anfrage(`/api/dokumente/${drin.id}/vorschaubild`, {}, pruefer)).status).toBe(200);
    expect((await t.anfrage(`/api/dokumente/${draussen.id}/vorschaubild`, {}, pruefer)).status).toBe(404);
    const token = await tokenAnlegen(t, cookie, "lesen");
    const res = await t.anfrage(`/api/dokumente/${drin.id}/vorschaubild`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
