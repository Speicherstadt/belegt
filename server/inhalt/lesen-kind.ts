import { eRechnungXml, lesen } from "./inhalt.ts";

/*
 * Liest eine Datei in einem eigenen Prozess (siehe lesenImKind): Datei auf stdin, Typ und „ocr“ als Argumente,
 * Ergebnis als JSON auf stdout. So hält ein PDF, an dem pdf.js hängen bleibt, nur diesen Prozess auf. Mit „xml“ statt
 * „ocr“ nur das XML einer E-Rechnung (eRechnungXmlImKind).
 */
const [mimeType = "", modus = ""] = process.argv.slice(2);
const bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
const ergebnis =
  modus === "xml"
    ? { xml: await eRechnungXml(bytes, mimeType) }
    : await lesen(bytes, mimeType, { ocr: modus === "ocr" });
process.stdout.write(JSON.stringify(ergebnis));
