import { archivPdf } from "./erzeugen.ts";

/*
 * Archivfassung in einem eigenen Prozess (siehe archivfassungImKind): Datei auf stdin, Typ und Zeitlimit als Argumente,
 * Seitenzahl und PDF (Base64) als JSON auf stdout, oder die Meldung, warum es keine gibt.
 */
const [mimeType = "", zeitlimit = ""] = process.argv.slice(2);
const bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
const ergebnis = await archivPdf(bytes, mimeType, Number(zeitlimit) || undefined).then(
  ({ pdf, seiten }) => ({ seiten, pdf: Buffer.from(pdf).toString("base64") }),
  (err: unknown) => ({ fehler: err instanceof Error ? err.message : "Keine Archivfassung" }),
);
process.stdout.write(JSON.stringify(ergebnis));
