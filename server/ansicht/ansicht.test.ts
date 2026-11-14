import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALTE_OFFICE_TYPEN, dateityp } from "../dokumente/dateityp.ts";
import { OFFICE_TYPEN } from "../inhalt/office.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { type Abfragen, ansichtenErzeugen, MAX_ANSICHT, zuPdf } from "./ansicht.ts";

/** Kopf einer Compound File und ein Verzeichniseintrag mit dem Namen des Hauptstreams (UTF-16LE) */
const cfb = (strom: string) => {
  const b = new Uint8Array(2048);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  b.set(Buffer.from(`Root Entry\0`, "utf16le"), 1024);
  b.set(Buffer.from(`${strom}\0`, "utf16le"), 1152);
  return b;
};

const docx = () =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Neu</w:t></w:r></w:p></w:body></w:document>"),
  });

async function pdfMit(text: string) {
  const doc = await PDFDocument.create();
  const seite = doc.addPage();
  seite.drawText(text, { x: 50, y: 700, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return new Uint8Array(await doc.save());
}

/** Ein Vorschau-Dienst, der festhält, was ankommt */
function dienst(antwort: (name: string) => Response | Promise<Response>) {
  const anfragen: { url: string; name: string; groesse: number }[] = [];
  const abfragen: Abfragen = async (url, init) => {
    if (url.endsWith("/health")) return antwort("/health");
    const datei = (init.body as FormData).get("files") as File;
    anfragen.push({ url, name: datei.name, groesse: datei.size });
    return antwort(datei.name);
  };
  return { anfragen, abfragen };
}

describe("Ansicht als PDF für Office-Dateien", () => {
  it("erkennt alte Word-, Excel- und PowerPoint-Dateien und RTF am Inhalt", () => {
    expect(dateityp(cfb("WordDocument"))).toBe(ALTE_OFFICE_TYPEN.doc);
    expect(dateityp(cfb("Workbook"))).toBe(ALTE_OFFICE_TYPEN.xls);
    expect(dateityp(cfb("PowerPoint Document"))).toBe(ALTE_OFFICE_TYPEN.ppt);
    expect(dateityp(strToU8("{\\rtf1\\ansi Hallo}"))).toBe(ALTE_OFFICE_TYPEN.rtf);
    // Eine Compound File ohne bekannten Hauptstream (etwa ein verschlüsseltes Office-Dokument) bleibt unbekannt
    expect(dateityp(cfb("EncryptedPackage"))).toBe("application/octet-stream");
  });

  it("schickt die Datei mit passender Endung an den Dienst und nimmt nur ein PDF zurück", async () => {
    const pdf = await pdfMit("Ansicht");
    const d = dienst(() => new Response(pdf));
    expect(await zuPdf(docx(), OFFICE_TYPEN.docx, "http://vorschau:3000", d)).toEqual(new Uint8Array(pdf));
    await zuPdf(cfb("WordDocument"), ALTE_OFFICE_TYPEN.doc, "http://vorschau:3000/", d);
    expect(d.anfragen.map((a) => [a.url, a.name])).toEqual([
      ["http://vorschau:3000/forms/libreoffice/convert", "dokument.docx"],
      ["http://vorschau:3000/forms/libreoffice/convert", "dokument.doc"],
    ]);

    await expect(
      zuPdf(
        docx(),
        OFFICE_TYPEN.docx,
        "http://v",
        dienst(() => new Response("<html>")),
      ),
    ).rejects.toThrow("kein PDF");
    await expect(
      zuPdf(
        docx(),
        OFFICE_TYPEN.docx,
        "http://v",
        dienst(() => new Response("kaputt", { status: 400 })),
      ),
    ).rejects.toThrow("Nicht umwandelbar (400)");
    const riesig = new Response(new Uint8Array(8), { headers: { "content-length": String(MAX_ANSICHT + 1) } });
    await expect(
      zuPdf(
        docx(),
        OFFICE_TYPEN.docx,
        "http://v",
        dienst(() => riesig),
      ),
    ).rejects.toThrow("zu groß");
    await expect(zuPdf(strToU8("x"), "text/plain", "http://v", d)).rejects.toThrow("Keine Ansicht");
  });

  it("hält eigenes Zeitlimit beim gesunden Dienst für einen Fehler der Datei, sonst für einen Ausfall", async () => {
    const zeitlimit =
      (gesund: boolean): Abfragen =>
      async (url) => {
        if (url.endsWith("/health")) return new Response("", { status: gesund ? 200 : 503 });
        throw new DOMException("Zeitlimit", "TimeoutError");
      };
    await expect(zuPdf(docx(), OFFICE_TYPEN.docx, "http://v", { abfragen: zeitlimit(true) })).rejects.toThrow(
      "Nicht umwandelbar (Zeitlimit)",
    );
    await expect(zuPdf(docx(), OFFICE_TYPEN.docx, "http://v", { abfragen: zeitlimit(false) })).rejects.toMatchObject({
      nichtErreichbar: true,
    });
  });
});

describe.skipIf(!testDatenbankUrl)("Ansichten gegen Postgres", () => {
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
  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("wartet, wenn der Dienst nicht da ist, und erzeugt dann Ansichten; Text alter Formate kommt in die Suche", async () => {
    // Einmal gebaut: fflate schreibt die Uhrzeit in das ZIP
    const original = docx();
    const neu = await hoch(original, "angebot.docx");
    const alt = await hoch(cfb("WordDocument"), "altvertrag.doc");
    expect(alt.mimeType).toBe(ALTE_OFFICE_TYPEN.doc);
    await hoch(await pdfMit("schon ein PDF"), "rechnung.pdf");

    const weg = dienst(() => new Response("", { status: 503 }));
    expect(await ansichtenErzeugen(t, "http://vorschau", { abfragen: weg.abfragen })).toMatchObject({
      erzeugt: 0,
      fehler: 0,
      meldung: "Vorschau-Dienst antwortet 503",
    });
    expect(await (await als(`/api/dokumente/${neu.id}/ansicht`)).status).toBe(404);

    const pdfs: Record<string, Uint8Array<ArrayBuffer>> = {
      "dokument.docx": await pdfMit("Angebot als Ansicht"),
      "dokument.doc": await pdfMit("Mietvertrag Lagerhalle Altbestand"),
    };
    const da = dienst((name) => new Response(pdfs[name]));
    expect(await ansichtenErzeugen(t, "http://vorschau", { abfragen: da.abfragen })).toEqual({ erzeugt: 2, fehler: 0 });
    // Das PDF geht nicht an den Dienst, und ein zweiter Lauf fragt nichts mehr
    expect(da.anfragen.map((a) => a.name).sort()).toEqual(["dokument.doc", "dokument.docx"]);
    expect(await ansichtenErzeugen(t, "http://vorschau", { abfragen: da.abfragen })).toEqual({ erzeugt: 0, fehler: 0 });

    expect((await (await als(`/api/dokumente/${neu.id}`)).json()).ansicht).toBe(true);
    const res = await als(`/api/dokumente/${neu.id}/ansicht`);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(`inline; filename*=UTF-8''angebot%20%28Ansicht%29.pdf`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(pdfs["dokument.docx"]!));
    // Die Datei selbst bleibt das Original
    expect(new Uint8Array(await (await als(`/api/dokumente/${neu.id}/datei`)).arrayBuffer())).toEqual(original);

    const suche = async (q: string) =>
      (await (await als(`/api/dokumente?suche=${encodeURIComponent(q)}`)).json()).map((d: { id: string }) => d.id);
    expect(await suche("Lagerhalle")).toEqual([alt.id]);
  });

  it("hält fest, was nicht umwandelbar ist, und fragt dafür nicht wieder", async () => {
    const kaputt = await hoch(cfb("PowerPoint Document"), "kaputt.ppt");
    const d = dienst(() => new Response("Fehler beim Umwandeln", { status: 400 }));
    expect(await ansichtenErzeugen(t, "http://vorschau", { abfragen: d.abfragen })).toEqual({ erzeugt: 0, fehler: 1 });
    expect(await ansichtenErzeugen(t, "http://vorschau", { abfragen: d.abfragen })).toEqual({ erzeugt: 0, fehler: 0 });
    expect((await (await als(`/api/dokumente/${kaputt.id}`)).json()).ansicht).toBe(false);
  });

  it("löscht die Ansicht mit dem Dokument", async () => {
    const d = await hoch(cfb("Workbook"), "liste.xls");
    const pdf = await pdfMit("Inventurliste Sägewerk");
    await ansichtenErzeugen(t, "http://vorschau", { abfragen: dienst(() => new Response(pdf)).abfragen });
    expect((await als(`/api/dokumente/${d.id}/ansicht`)).status).toBe(200);
    await als(`/api/dokumente/${d.id}/einordnung`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ art: "frei", entstanden: "2026-01-02" }),
    });
    expect((await als(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect((await als(`/api/dokumente/${d.id}/ansicht`)).status).toBe(410);
    expect(await t.sql`select 1 from ansichten where dokument_id = ${d.id}`).toHaveLength(0);
    expect(await t.sql`select 1 from inhalte where dokument_id = ${d.id}`).toHaveLength(0);
    // Auch ein Worker, der gerade umwandelt, bringt sie nicht zurück
    await t.sql`insert into ansichten (dokument_id, pdf) values (${d.id}, ${Buffer.from(pdf)})`;
    expect(await t.sql`select 1 from ansichten where dokument_id = ${d.id}`).toHaveLength(0);
  });

  it("hält eine Datei fest, an der der Dienst sein Zeitlimit überschreitet, statt alle späteren aufzuhalten", async () => {
    // Gotenberg antwortet 503, wenn eine Umwandlung länger als --api-timeout dauert (pkg/modules/api/middlewares.go)
    const schwer = await hoch(strToU8("{\\rtf1\\ansi Riesige Tabelle}"), "schwer.rtf");
    const leicht = await hoch(docx(), "leicht.docx");
    const pdf = await pdfMit("Leicht");
    const d = dienst((name) => (name === "dokument.rtf" ? new Response("", { status: 503 }) : new Response(pdf)));
    for (let lauf = 0; lauf < 3; lauf++) await ansichtenErzeugen(t, "http://vorschau", { abfragen: d.abfragen });
    expect((await (await als(`/api/dokumente/${leicht.id}`)).json()).ansicht).toBe(true);
    expect(await t.sql`select fehler from ansichten where dokument_id = ${schwer.id}`).toEqual([
      { fehler: "Nicht umwandelbar (503)" },
    ]);
    expect(d.anfragen.filter((a) => a.name === "dokument.rtf")).toHaveLength(1);
  });

  it("wartet weiter, wenn der Dienst 503 antwortet und auch sein Gesundheitscheck scheitert", async () => {
    const spaeter = await hoch(strToU8("{\\rtf1\\ansi Spaeter}"), "spaeter.rtf");
    const d = dienst(() => new Response("", { status: 503 }));
    expect(await ansichtenErzeugen(t, "http://vorschau", { abfragen: d.abfragen })).toMatchObject({ erzeugt: 0 });
    expect(await t.sql`select 1 from ansichten where dokument_id = ${spaeter.id}`).toHaveLength(0);
  });
});

/** Gegen den echten Dienst (in der CI ein Container mit Gotenberg) */
describe.skipIf(!process.env.VORSCHAU_TEST_URL)("Ansicht mit dem echten Vorschau-Dienst", () => {
  const url = process.env.VORSCHAU_TEST_URL ?? "";
  beforeAll(async () => {
    for (let i = 0; i < 60; i++) {
      if (
        await fetch(new URL("/health", url)).then(
          (r) => r.ok,
          () => false,
        )
      )
        return;
      await Bun.sleep(1000);
    }
  }, 70_000);

  const docxVollstaendig = () =>
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Wartungsvertrag Kesselanlage</w:t></w:r></w:p></w:body></w:document>',
      ),
    });

  it("wandelt Word und RTF in ein PDF mit demselben Text", async () => {
    const { lesen } = await import("../inhalt/inhalt.ts");
    const word = await zuPdf(docxVollstaendig(), OFFICE_TYPEN.docx, url);
    expect((await lesen(word, "application/pdf")).text).toContain("Wartungsvertrag Kesselanlage");
    const rtf = await zuPdf(strToU8("{\\rtf1\\ansi Inventur Holzlager}"), ALTE_OFFICE_TYPEN.rtf, url);
    expect((await lesen(rtf, "application/pdf")).text).toContain("Inventur Holzlager");
  }, 120_000);
});
