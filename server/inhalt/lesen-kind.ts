import { lesen } from "./inhalt.ts";

/*
 * Liest eine Datei in einem eigenen Prozess (siehe lesenImKind): Datei auf stdin, Typ und „ocr“ als Argumente,
 * Ergebnis als JSON auf stdout. So hält ein PDF, an dem pdf.js hängen bleibt, nur diesen Prozess auf.
 */
const [mimeType = "", ocr = ""] = process.argv.slice(2);
const bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
process.stdout.write(JSON.stringify(await lesen(bytes, mimeType, { ocr: ocr === "ocr" })));
