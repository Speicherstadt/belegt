import { bildAlsPdf, seiteAlsJpeg } from "./raster.ts";

/*
 * Vorschaubild eines Bildes in einem eigenen Prozess (siehe vorschaubild in raster.ts): Bild auf stdin, Typ als
 * Argument, das JPEG als Base64 auf stdout.
 */
const [mimeType = ""] = process.argv.slice(2);
const bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
const jpeg = await seiteAlsJpeg(await bildAlsPdf(bytes, mimeType));
process.stdout.write(Buffer.from(jpeg).toString("base64"));
