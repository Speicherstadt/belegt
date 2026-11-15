import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { istUngueltig, neuerName, SeitenOperation, seitenBearbeiten, zusammenfuegen } from "./seiten.ts";

/** Ein PDF mit Seiten, deren Breite ihre Nummer verrät (100 + Nummer pt); Seite 2 schon um 90° gedreht */
async function pdf(seiten: number, name = "A") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= seiten; i++) {
    const seite = doc.addPage([100 + i, 200]);
    seite.drawText(`${name}${i}`, { x: 10, y: 10, size: 8, font });
    if (i === 2) seite.setRotation(degrees(90));
  }
  return new Uint8Array(await doc.save());
}

/** Je Seite Nummer (aus der Breite) und Drehung */
async function seiten(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((s) => [Math.round(s.getWidth()) - 100, s.getRotation().angle]);
}

const fehler = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(istUngueltig(err), String(err)).toBe(true);
  return (err as Error).message;
};

describe("Seiten bearbeiten mit pdf-lib", () => {
  it("dreht einzelne Seiten zur vorhandenen Drehung dazu und lässt die übrigen", async () => {
    const [neu] = await seitenBearbeiten(await pdf(3), {
      operation: "drehen",
      drehungen: [
        { seite: 1, grad: 90 },
        { seite: 2, grad: 270 },
      ],
    });
    expect(await seiten(neu!)).toEqual([
      [1, 90],
      [2, 0],
      [3, 0],
    ]);
    expect(
      await fehler(seitenBearbeiten(await pdf(2), { operation: "drehen", drehungen: [{ seite: 3, grad: 90 }] })),
    ).toMatch("Seite 3 gibt es nicht");
  });

  it("entfernt Seiten, aber nie alle", async () => {
    const [neu] = await seitenBearbeiten(await pdf(4), { operation: "entfernen", seiten: [1, 3] });
    expect(await seiten(neu!)).toEqual([
      [2, 90],
      [4, 0],
    ]);
    expect(await fehler(seitenBearbeiten(await pdf(2), { operation: "entfernen", seiten: [1, 2] }))).toMatch(
      "keine Seite",
    );
  });

  it("teilt nach einer Seite in zwei PDFs", async () => {
    const teile = await seitenBearbeiten(await pdf(3), { operation: "teilen", nach: 1 });
    expect(await Promise.all(teile.map(seiten))).toEqual([
      [[1, 0]],
      [
        [2, 90],
        [3, 0],
      ],
    ]);
    expect(await fehler(seitenBearbeiten(await pdf(3), { operation: "teilen", nach: 3 }))).toMatch("nicht teilen");
  });

  it("fügt PDFs in der gewählten Reihenfolge zusammen", async () => {
    const neu = await zusammenfuegen([await pdf(1, "B"), await pdf(2, "A")]);
    expect(await seiten(neu)).toEqual([
      [1, 0],
      [1, 0],
      [2, 90],
    ]);
    expect(await fehler(zusammenfuegen([await pdf(1)]))).toMatch("zwei");
  });

  it("ergibt für dieselbe Operation dieselben Bytes und lehnt Unsinn ab", async () => {
    const quelle = await pdf(2);
    const op: SeitenOperation = { operation: "entfernen", seiten: [1] };
    expect((await seitenBearbeiten(quelle, op))[0]).toEqual((await seitenBearbeiten(quelle, op))[0]);
    expect(SeitenOperation.safeParse({ operation: "drehen", drehungen: [{ seite: 1, grad: 45 }] }).success).toBe(false);
    expect(SeitenOperation.safeParse({ operation: "entfernen", seiten: [] }).success).toBe(false);
    expect(SeitenOperation.safeParse({ operation: "loeschen" }).success).toBe(false);
  });

  it("benennt das neue Dokument nach der Quelle", () => {
    expect(neuerName("scan.pdf", "drehen")).toBe("scan (gedreht).pdf");
    expect(neuerName("scan.PDF", "teilen", 2)).toBe("scan-2.pdf");
    expect(neuerName(null, "zusammenfuegen")).toBe("dokument (zusammengefügt).pdf");
  });
});
