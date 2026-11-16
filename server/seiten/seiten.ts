import { degrees, PDFDocument } from "pdf-lib";
import { z } from "zod";

/*
 * Seiten eines PDFs bearbeiten, ohne das Original anzufassen: Jede Operation baut mit pdf-lib ein neues PDF aus Kopien
 * der Seiten (copyPages), das Belegt als eigenes Dokument aufnimmt (server/seiten/ableiten.ts). Ohne neue Metadaten,
 * damit dieselbe Operation dieselben Bytes ergibt.
 */

/** Höchstens so viele Seiten nennt eine Operation */
const MAX_SEITEN = 5000;
const Seite = z.number().int().min(1).max(MAX_SEITEN);

export const SeitenOperation = z.discriminatedUnion("operation", [
  /** Drehung im Uhrzeigersinn, zur vorhandenen Drehung der Seite dazu */
  z.object({
    operation: z.literal("drehen"),
    drehungen: z
      .array(z.object({ seite: Seite, grad: z.union([z.literal(90), z.literal(180), z.literal(270)]) }))
      .min(1)
      .max(MAX_SEITEN),
  }),
  z.object({ operation: z.literal("entfernen"), seiten: z.array(Seite).min(1).max(MAX_SEITEN) }),
  /** Zwei Teile: Seiten 1 bis nach und der Rest */
  z.object({ operation: z.literal("teilen"), nach: Seite }),
]);
export type SeitenOperation = z.infer<typeof SeitenOperation>;
export type Operation = SeitenOperation["operation"] | "zusammenfuegen";

/** Fehler an der Eingabe (Seite gibt es nicht, nichts bliebe übrig), nicht am PDF */
const ungueltig = (meldung: string) => Object.assign(new Error(meldung), { ungueltig: true });
export const istUngueltig = (err: unknown): err is Error => err instanceof Error && "ungueltig" in err;

const laden = (pdf: Uint8Array) => PDFDocument.load(pdf, { updateMetadata: false });

/** Ein neues PDF aus den Seiten (ab 0) der Quelle, in dieser Reihenfolge; drehung je Seite in Grad dazu */
async function auswahl(quelle: PDFDocument, seiten: number[], drehung: Map<number, number> = new Map()) {
  const ziel = await PDFDocument.create({ updateMetadata: false });
  const kopien = await ziel.copyPages(quelle, seiten);
  kopien.forEach((kopie, i) => {
    const grad = drehung.get(seiten[i]!) ?? 0;
    if (grad) kopie.setRotation(degrees((((kopie.getRotation().angle + grad) % 360) + 360) % 360));
    ziel.addPage(kopie);
  });
  return ziel.save();
}

function pruefeSeiten(seiten: number[], anzahl: number) {
  const zuGross = seiten.find((s) => s > anzahl);
  if (zuGross) throw ungueltig(`Seite ${zuGross} gibt es nicht, das PDF hat ${anzahl}`);
}

/** Wendet eine Operation auf ein PDF an: ein neues PDF, beim Teilen zwei */
export async function seitenBearbeiten(pdf: Uint8Array, op: SeitenOperation): Promise<Uint8Array[]> {
  const quelle = await laden(pdf);
  const anzahl = quelle.getPageCount();
  const alle = quelle.getPageIndices();
  switch (op.operation) {
    case "drehen": {
      pruefeSeiten(
        op.drehungen.map((d) => d.seite),
        anzahl,
      );
      const drehung = new Map<number, number>();
      for (const d of op.drehungen) drehung.set(d.seite - 1, ((drehung.get(d.seite - 1) ?? 0) + d.grad) % 360);
      if ([...drehung.values()].every((g) => g === 0)) throw ungueltig("Keine Seite ist gedreht");
      return [await auswahl(quelle, alle, drehung)];
    }
    case "entfernen": {
      pruefeSeiten(op.seiten, anzahl);
      const weg = new Set(op.seiten.map((s) => s - 1));
      const bleiben = alle.filter((s) => !weg.has(s));
      if (!bleiben.length) throw ungueltig("Es bliebe keine Seite übrig");
      return [await auswahl(quelle, bleiben)];
    }
    case "teilen": {
      if (op.nach >= anzahl)
        throw ungueltig(
          `Nach Seite ${op.nach} lässt sich ein PDF mit ${anzahl === 1 ? "einer Seite" : `${anzahl} Seiten`} nicht teilen`,
        );
      return [await auswahl(quelle, alle.slice(0, op.nach)), await auswahl(quelle, alle.slice(op.nach))];
    }
  }
}

/** Fügt PDFs in dieser Reihenfolge zu einem neuen zusammen */
export async function zusammenfuegen(pdfs: Uint8Array[]): Promise<Uint8Array> {
  if (pdfs.length < 2) throw ungueltig("Mindestens zwei PDFs");
  const ziel = await PDFDocument.create({ updateMetadata: false });
  for (const pdf of pdfs) {
    const quelle = await laden(pdf);
    for (const seite of await ziel.copyPages(quelle, quelle.getPageIndices())) ziel.addPage(seite);
  }
  return ziel.save();
}

/** Name des neuen Dokuments aus dem der Quelle */
export function neuerName(dateiname: string | null, operation: Operation, teil?: number): string {
  const stamm = (dateiname ?? "dokument").replace(/\.pdf$/i, "") || "dokument";
  if (operation === "teilen") return `${stamm}-${teil ?? 1}.pdf`;
  const zusatz = { drehen: "gedreht", entfernen: "Seiten entfernt", zusammenfuegen: "zusammengefügt" }[operation];
  return `${stamm} (${zusatz}).pdf`;
}
