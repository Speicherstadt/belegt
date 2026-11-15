import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stapelTeilen } from "./trennen.ts";

/*
 * Teilt einen Stapel in einem eigenen Prozess (siehe teilenImKind): PDF auf stdin, Code und Zielordner als Argumente.
 * Die Teile landen als teil-1.pdf, teil-2.pdf … im Zielordner, auf stdout steht {"teile": Anzahl}, 0 ohne Trennblatt.
 */
const [code = "", ordner = ""] = process.argv.slice(2);
const pdf = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
const teile = (await stapelTeilen(pdf, code, undefined, ordner)) ?? [];
for (const [i, teil] of teile.entries()) await writeFile(join(ordner, `teil-${i + 1}.pdf`), teil);
process.stdout.write(JSON.stringify({ teile: teile.length }));
