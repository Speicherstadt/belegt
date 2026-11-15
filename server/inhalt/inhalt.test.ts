import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { inhalteErzeugen, lesen, lesenImKind } from "./inhalt.ts";

const beispiel = (name: string) => readFileSync(new URL(`./beispiele/${name}`, import.meta.url));

/** Ein PDF mit Text und, wenn angegeben, eingebetteter E-Rechnung wie bei ZUGFeRD */
async function pdf(text: string, anhang?: { name: string; xml: Uint8Array }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { x: 50, y: 700, font, size: 12 });
  if (anhang) await doc.attach(anhang.xml, anhang.name, { mimeType: "text/xml" });
  return doc.save();
}

/** Ein PDF, dessen Schrift „B“ auf U+0000 abbildet (ToUnicode), wie es kaputte Schriften in echten PDFs tun */
async function pdfMitNul(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText("Nulltext AB", { x: 50, y: 700, font, size: 12 });
  await doc.flush();
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <42> <0000> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end";
  const schrift = doc.context.lookup(font.ref) as unknown as { set: (k: PDFName, v: unknown) => void };
  schrift.set(PDFName.of("ToUnicode"), doc.context.register(doc.context.stream(cmap)));
  return doc.save();
}

describe("Inhalt lesen", () => {
  it("liest Text aus einem PDF und die eingebettete E-Rechnung (ZUGFeRD, Factur-X)", async () => {
    const g = await lesen(
      await pdf("Rechnung RE-2026-0042", { name: "factur-x.xml", xml: beispiel("cii.xml") }),
      "application/pdf",
    );
    expect(g.text).toContain("Rechnung RE-2026-0042");
    expect(g.erechnung).toMatchObject({ syntax: "cii", nummer: "RE-2026-0042", bruttoCent: 11900 });
  });

  it("nimmt nur eingebettete Dateien mit dem Namen einer E-Rechnung", async () => {
    const g = await lesen(await pdf("Anlage", { name: "irgendwas.xml", xml: beispiel("cii.xml") }), "application/pdf");
    expect(g.erechnung).toBeNull();
  });

  it("liest eine XRechnung als XML und lässt Bilder leer", async () => {
    expect((await lesen(beispiel("ubl.xml"), "application/xml")).erechnung).toMatchObject({ nummer: "2026/77" });
    expect(await lesen(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toEqual({ text: "", erechnung: null });
  });
});

describe("Lesen im eigenen Prozess", () => {
  it("liefert dasselbe wie lesen", async () => {
    const bytes = await pdf("Rechnung RE-2026-0042", { name: "factur-x.xml", xml: beispiel("cii.xml") });
    expect(await lesenImKind(bytes, "application/pdf")).toEqual(await lesen(bytes, "application/pdf"));
  });

  it("beendet den Prozess nach dem Zeitlimit, statt den Worker aufzuhalten", async () => {
    const bytes = await pdf("langsam");
    await expect(lesenImKind(bytes, "application/pdf", { zeitlimit: 1 })).rejects.toThrow(/abgebrochen/);
  });
});

// Jedes Dokument liest ein eigener Prozess (lesenImKind); unter paralleler Last dauert das länger als 5 s
describe.skipIf(!testDatenbankUrl)("Inhalte gegen Postgres", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, inhaber);

  async function hochladen(bytes: Uint8Array, name: string) {
    const form = new FormData();
    form.append("datei", new File([new Uint8Array(bytes)], name));
    return (await (await als("/api/dokumente", { method: "POST", body: form })).json()) as { id: string };
  }

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("liest neue Dokumente einmal, macht den Text durchsuchbar und schlägt die Einordnung aus der E-Rechnung vor", async () => {
    const rechnung = await hochladen(
      await pdf("Werkzeugkoffer Lieferung Kalenderwoche", { name: "factur-x.xml", xml: beispiel("cii.xml") }),
      "rechnung.pdf",
    );
    const xrechnung = await hochladen(beispiel("ubl.xml"), "xrechnung.xml");
    const kaputt = await hochladen(new TextEncoder().encode("%PDF-1.7\nkaputt"), "kaputt.pdf");
    expect(await (await als(`/api/dokumente/${rechnung.id}/inhalt`)).json()).toBeNull();

    expect(await inhalteErzeugen(t)).toEqual({ gelesen: 2, fehler: 1 });
    expect(await inhalteErzeugen(t)).toEqual({ gelesen: 0, fehler: 0 });

    expect(await (await als(`/api/dokumente/${rechnung.id}/inhalt`)).json()).toMatchObject({
      erechnung: { nummer: "RE-2026-0042", verkaeufer: "Muster & Co. KG", bruttoCent: 11900 },
      fehler: null,
    });
    expect((await (await als(`/api/dokumente/${kaputt.id}/inhalt`)).json()).fehler).toBeTruthy();

    // Text aus dem PDF und die Nummer der E-Rechnung finden das Dokument
    const suche = async (q: string) =>
      (await (await als(`/api/dokumente?suche=${encodeURIComponent(q)}`)).json()).map((d: { id: string }) => d.id);
    expect(await suche("Werkzeugkoffer")).toEqual([rechnung.id]);
    expect(await suche("Werkstatt Beispiel")).toEqual([xrechnung.id]);

    const v = await (await als(`/api/dokumente/${xrechnung.id}/vorschlag`)).json();
    expect(v).toMatchObject({ vorschlag: null, erechnung: { datum: "2026-04-02", nummer: "2026/77" } });
  });

  it("speichert Text mit NUL-Zeichen, die Postgres in text nicht nimmt", async () => {
    const d = await hochladen(await pdfMitNul(), "nul.pdf");
    expect(await inhalteErzeugen(t)).toEqual({ gelesen: 1, fehler: 0 });
    const i = await (await als(`/api/dokumente/${d.id}/inhalt`)).json();
    expect(i).toMatchObject({ fehler: null });
    expect(i.textLaenge).toBeGreaterThan(0);
  });

  it("vergisst den gelesenen Text eines gelöschten Dokuments, auch in der Suche", async () => {
    const d = await hochladen(await pdf("Schlafzimmerkommode Rechnung"), "kommode.pdf");
    await inhalteErzeugen(t);
    const suche = async () =>
      (await (await als("/api/dokumente?suche=Schlafzimmerkommode&gruppe=geloescht")).json()).length +
      (await (await als("/api/dokumente?suche=Schlafzimmerkommode")).json()).length;
    expect(await suche()).toBe(1);
    const json = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(
      (await als(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-02" }))).status,
    ).toBe(201);
    // Frei Abgelegtes löscht der Inhaber sofort; die Datei ist weg, ihr Text darf nicht bleiben
    expect((await als(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect(await (await als(`/api/dokumente/${d.id}/inhalt`)).json()).toBeNull();
    expect(await suche()).toBe(0);
  });
});
