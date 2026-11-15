import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ordnerEinlesen, type Zustand } from "../ordner/ordner.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { TRENNBLATT_CODE, trennblattPdf } from "./trennblatt.ts";
import {
  begrenzt,
  dateiTeilen,
  MAX_SEITEN,
  stapelTeilen,
  teilbereiche,
  teilenImKind,
  teilName,
  trennenVerfuegbar,
  trennerSuchen,
} from "./trennen.ts";

describe("teilbereiche", () => {
  it("teilt an den Trennblättern und lässt sie weg", () => {
    expect(teilbereiche(4, [1])).toEqual([[0], [2, 3]]);
    expect(teilbereiche(6, [2, 4])).toEqual([[0, 1], [3], [5]]);
  });

  it("lässt leere Teile weg: Trennblatt vorn, hinten oder doppelt", () => {
    expect(teilbereiche(5, [0, 2, 3])).toEqual([[1], [4]]);
    expect(teilbereiche(3, [2])).toEqual([[0, 1]]);
  });

  it("ohne Trennblatt oder nur mit Trennblättern bleibt das PDF, wie es ist", () => {
    expect(teilbereiche(3, [])).toBeNull();
    expect(teilbereiche(2, [0, 1])).toBeNull();
  });
});

describe("teilName", () => {
  it("hängt die Nummer des Teils an", () => {
    expect(teilName("scan.pdf", 1)).toBe("scan-1.pdf");
    expect(teilName("Stapel.PDF", 2)).toBe("Stapel-2.pdf");
    expect(teilName("ohne-endung", 3)).toBe("ohne-endung-3.pdf");
  });
});

describe("begrenzt", () => {
  it("lässt höchstens max Arbeiten zugleich laufen, weitere warten, über die Warteschlange hinaus null", async () => {
    const tor = begrenzt(1, 1);
    let laufend = 0;
    let hoechstens = 0;
    const freigeben: (() => void)[] = [];
    const arbeit = () =>
      new Promise<string>((ok) => {
        laufend++;
        hoechstens = Math.max(hoechstens, laufend);
        freigeben.push(() => {
          laufend--;
          ok("fertig");
        });
      });
    const a = tor(arbeit);
    const b = tor(arbeit);
    // Eine läuft, eine wartet: die dritte bekommt keinen Platz
    expect(await tor(arbeit)).toBeNull();
    await Promise.resolve();
    freigeben.shift()!();
    expect(await a).toBe("fertig");
    await new Promise((r) => setTimeout(r, 0));
    freigeben.shift()!();
    expect(await b).toBe("fertig");
    expect(hoechstens).toBe(1);
  });
});

/** Ein Stapel: Seite A, Trennblatt, Seiten B und C */
async function stapel(trennblatt?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const seite = (text: string) => doc.addPage([595, 842]).drawText(text, { x: 50, y: 700, font, size: 24 });
  seite("Rechnung A");
  if (trennblatt) {
    const [blatt] = await doc.copyPages(await PDFDocument.load(trennblatt), [0]);
    doc.addPage(blatt);
  }
  seite("Rechnung B Seite 1");
  seite("Rechnung B Seite 2");
  return doc.save();
}

const seitenzahl = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPageCount();

describe.skipIf(!trennenVerfuegbar())("Trennblätter (pdftoppm)", { timeout: 60_000 }, () => {
  let mitTrenner: Uint8Array;
  beforeAll(async () => {
    mitTrenner = await stapel(await trennblattPdf());
  });

  it("teilt einen Stapel am Trennblatt in zwei PDFs mit 1 und 2 Seiten", async () => {
    const teile = await stapelTeilen(mitTrenner, TRENNBLATT_CODE);
    expect(teile).toHaveLength(2);
    expect(await seitenzahl(teile![0]!)).toBe(1);
    expect(await seitenzahl(teile![1]!)).toBe(2);
  });

  it("teilt im eigenen Prozess genauso, und dasselbe Teil hat immer dieselben Bytes", async () => {
    const imKind = await teilenImKind(mitTrenner, TRENNBLATT_CODE);
    expect(imKind).toEqual(await stapelTeilen(mitTrenner, TRENNBLATT_CODE));
  });

  it("teilt nicht ohne Trennblatt, nicht an einem anderen Code und nicht, was kein PDF ist", async () => {
    expect(await stapelTeilen(await stapel(), TRENNBLATT_CODE)).toBeNull();
    expect(await stapelTeilen(await stapel(await trennblattPdf("ANDERER-CODE")), TRENNBLATT_CODE)).toBeNull();
    expect(await dateiTeilen(new TextEncoder().encode("kein PDF"), "x.txt", { code: TRENNBLATT_CODE })).toBeNull();
  });

  it("erkennt ein gescanntes Trennblatt (Bild mit 200 dpi, leicht verkleinert)", async () => {
    const ordner = await mkdtemp(join(tmpdir(), "belegt-scan-"));
    try {
      await writeFile(join(ordner, "blatt.pdf"), await trennblattPdf());
      execFileSync("pdftoppm", [
        "-r",
        "200",
        "-gray",
        "-png",
        "-singlefile",
        join(ordner, "blatt.pdf"),
        join(ordner, "b"),
      ]);
      const scan = await PDFDocument.create();
      const bild = await scan.embedPng(await readFile(join(ordner, "b.png")));
      scan.addPage([595, 842]).drawImage(bild, { x: 20, y: 30, width: 555, height: 785 });
      expect(await stapelTeilen(await stapel(await scan.save()), TRENNBLATT_CODE)).toHaveLength(2);
    } finally {
      await rm(ordner, { recursive: true, force: true });
    }
  });

  it("liest einen eigenen Code aus TRENNBLATT_CODE", async () => {
    const teile = await stapelTeilen(await stapel(await trennblattPdf("FIRMA-TRENNER")), "FIRMA-TRENNER");
    expect(teile).toHaveLength(2);
  });

  it("teilt einen Stapel mit mehr als MAX_SEITEN Seiten nicht", async () => {
    const doc = await PDFDocument.load(mitTrenner);
    const [blatt] = await doc.copyPages(await PDFDocument.load(await stapel()), [0]);
    for (let i = 0; i < MAX_SEITEN; i++) doc.addPage(i === 0 ? blatt : [100, 100]);
    expect(await stapelTeilen(await doc.save(), TRENNBLATT_CODE)).toBeNull();
  });

  it("rendert riesige Seiten verkleinert, statt minutenlang zu rechnen", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 10; i++) doc.addPage([3000, 3000]).drawCircle({ x: 1500, y: 1500, size: 1400 });
    await expect(trennerSuchen(await doc.save(), TRENNBLATT_CODE, 10_000)).resolves.toEqual([]);
  });

  it("bricht ein kaputtes PDF im Kind ab, statt den Worker aufzuhalten", async () => {
    const kaputt = new TextEncoder().encode("%PDF-1.7\nkein echtes PDF");
    await expect(teilenImKind(kaputt, TRENNBLATT_CODE)).rejects.toThrow();
    await expect(teilenImKind(mitTrenner, TRENNBLATT_CODE, 1)).rejects.toThrow(/abgebrochen/);
  });

  it("lässt nach dem Zeitlimit kein pdftoppm des Kindes weiterlaufen", async () => {
    // Wenige KB, aber riesige Seiten: pdftoppm rechnet an jeder Seite Sekunden
    const doc = await PDFDocument.create();
    for (let i = 0; i < 20; i++) doc.addPage([3000, 3000]).drawCircle({ x: 1500, y: 1500, size: 1400 });
    const gross = await doc.save();
    const eigenes = await mkdtemp(join(tmpdir(), "belegt-zeitlimit-"));
    const vorher = process.env.TMPDIR;
    process.env.TMPDIR = eigenes;
    const laufend = () => {
      try {
        return execFileSync("pgrep", ["-f", eigenes], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    };
    try {
      await expect(teilenImKind(gross, TRENNBLATT_CODE, 2_000)).rejects.toThrow(/abgebrochen/);
      await new Promise((r) => setTimeout(r, 1_000));
      expect(laufend(), "pdftoppm läuft noch").toBe("");
      // Auch die Seitenbilder des abgebrochenen Kindes bleiben nicht liegen
      expect(await readdir(eigenes)).toEqual([]);
    } finally {
      process.env.TMPDIR = vorher;
      if (vorher === undefined) delete process.env.TMPDIR;
      for (const pid of laufend().split("\n").filter(Boolean)) process.kill(Number(pid), "SIGKILL");
      await rm(eigenes, { recursive: true, force: true });
    }
  });

  describe.skipIf(!testDatenbankUrl)("im Archiv", () => {
    let t: Awaited<ReturnType<typeof testApp>>;
    let cookie: string;
    let wurzel: string;
    beforeAll(async () => {
      t = await testApp();
      cookie = (await t.registrieren("anna@example.org")).cookie;
      wurzel = await mkdtemp(join(tmpdir(), "belegt-stapel-"));
    });
    afterAll(async () => {
      await t?.aufraeumen();
      await rm(wurzel, { recursive: true, force: true });
    });
    const dokumente = (muster: string) =>
      t.sql`select dateiname, quelle, sha256 from dokumente where dateiname like ${muster} order by dateiname`;

    it("nimmt einen Stapel aus dem Ordner als zwei Dokumente auf, ohne den Stapel selbst", async () => {
      const ordner = join(wurzel, "eingang");
      await mkdir(ordner);
      await writeFile(join(ordner, "stapel.pdf"), mitTrenner);
      let zustand: Zustand = new Map();
      const teilen = (bytes: Uint8Array, name: string) => dateiTeilen(bytes, name, { code: TRENNBLATT_CODE });
      for (let i = 0; i < 2; i++) zustand = (await ordnerEinlesen(t, { ordner, zustand, teilen })).zustand;
      expect(await readdir(ordner)).toEqual([]);
      const d = await dokumente("stapel%");
      expect(d.map((x) => [x.dateiname, x.quelle])).toEqual([
        ["stapel-1.pdf", "ordner"],
        ["stapel-2.pdf", "ordner"],
      ]);
      expect(await seitenzahl(new Uint8Array(await t.speicher.laden(d[1]!.sha256)))).toBe(2);
    });

    async function hochladen(bytes: Uint8Array, name: string, query = "") {
      const form = new FormData();
      form.append("datei", new File([new Uint8Array(bytes)], name));
      return t.anfrage(`/api/dokumente${query}`, { method: "POST", body: form }, cookie);
    }

    it("teilt beim Upload nur mit ?trennen=1", async () => {
      const ohne = await hochladen(mitTrenner, "upload.pdf");
      expect(ohne.status).toBe(201);
      expect((await ohne.json()).dateiname).toBe("upload.pdf");
      const res = await hochladen(mitTrenner, "geteilt.pdf", "?trennen=1");
      expect(res.status).toBe(201);
      const { dokumente: teile } = await res.json();
      expect(teile.map((d: { dateiname: string; quelle: string }) => [d.dateiname, d.quelle])).toEqual([
        ["geteilt-1.pdf", "upload"],
        ["geteilt-2.pdf", "upload"],
      ]);
      expect(teile[1].asn).toBe(teile[0].asn + 1);
      // Ohne Trennblatt: ein Dokument, unverändert
      const einzeln = await (await hochladen(await stapel(), "einzeln.pdf", "?trennen=1")).json();
      expect(einzeln.dokumente.map((d: { dateiname: string }) => d.dateiname)).toEqual(["einzeln.pdf"]);
    });

    it("liefert das Trennblatt als PDF zum Herunterladen", async () => {
      const res = await t.anfrage("/api/trennblatt.pdf", {}, cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("content-disposition")).toContain("attachment");
      const pdf = new Uint8Array(await res.arrayBuffer());
      expect(await stapelTeilen(await stapel(pdf), TRENNBLATT_CODE)).toHaveLength(2);
      expect((await t.anfrage("/api/trennblatt.pdf")).status).toBe(401);
    });
  });
});
