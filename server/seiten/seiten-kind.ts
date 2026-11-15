import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { istUngueltig, SeitenOperation, seitenBearbeiten, zusammenfuegen } from "./seiten.ts";

/*
 * Bearbeitet Seiten in einem eigenen Prozess (siehe bearbeitenImKind): Auftrag als JSON und Ordner als Argumente, die
 * PDFs als eingabe-1.pdf, eingabe-2.pdf … im Ordner. Die neuen PDFs landen als ausgabe-1.pdf … daneben; auf stdout
 * steht {"anzahl": n} oder {"fehler": "…", "ungueltig": true|false}.
 */
const [auftrag = "{}", ordner = "", eingaben = "1"] = process.argv.slice(2);
try {
  const pdfs: Uint8Array[] = [];
  for (let i = 1; i <= Number(eingaben); i++)
    pdfs.push(new Uint8Array(await readFile(join(ordner, `eingabe-${i}.pdf`))));
  const a = JSON.parse(auftrag) as { operation: string };
  const neu =
    a.operation === "zusammenfuegen"
      ? [await zusammenfuegen(pdfs)]
      : await seitenBearbeiten(pdfs[0]!, SeitenOperation.parse(a));
  for (const [i, pdf] of neu.entries()) await writeFile(join(ordner, `ausgabe-${i + 1}.pdf`), pdf);
  process.stdout.write(JSON.stringify({ anzahl: neu.length }));
} catch (err) {
  process.stdout.write(
    JSON.stringify(
      istUngueltig(err)
        ? { fehler: err.message, ungueltig: true }
        : { fehler: "Das PDF lässt sich nicht bearbeiten", ungueltig: false },
    ),
  );
}
