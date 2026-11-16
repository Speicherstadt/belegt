/**
 * Der FTP-Dienst (deploy/ftp) steht in beiden Compose-Dateien. Die Ports des passiven Modus legt vsftpd.conf fest;
 * veröffentlicht Compose einen anderen Bereich, bricht das Senden des Scanners nach der Anmeldung ab. Ebenso schreibt
 * der Dienst nur in den Ordner, den der Worker überwacht, wenn beide dasselbe ./eingang einhängen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wurzel = join(import.meta.dirname, "..");
const lesen = (datei: string) => readFileSync(join(wurzel, datei), "utf8");

/** Der Block eines Dienstes: die Zeilen ab „  name:“, solange sie tiefer eingerückt sind */
function dienst(text: string, name: string): string {
  const anfang = `\n  ${name}:\n`;
  expect(text).toContain(anfang);
  const zeilen = text.slice(text.indexOf(anfang) + anfang.length).split("\n");
  const ende = zeilen.findIndex((z) => z !== "" && !z.startsWith("    "));
  return zeilen.slice(0, ende).join("\n");
}

describe("FTP-Dienst für Scanner", () => {
  const konf = lesen("deploy/ftp/vsftpd.conf");
  const von = konf.match(/^pasv_min_port=(\d+)$/m)?.[1];
  const bis = konf.match(/^pasv_max_port=(\d+)$/m)?.[1];

  it.each(["deploy/compose.yml", "compose.yml"])(
    "veröffentlicht in %s den passiven Bereich aus vsftpd.conf",
    (datei) => {
      const ftp = dienst(lesen(datei), "ftp");
      expect(ftp).toContain(`- "${von}-${bis}:${von}-${bis}"`);
      expect(ftp).toContain("profiles: [ftp]");
    },
  );

  it.each(["deploy/compose.yml", "compose.yml"])("hängt in %s denselben Ordner ein wie der Worker", (datei) => {
    const text = lesen(datei);
    expect(dienst(text, "ftp")).toContain("- ./eingang:/eingang");
    expect(dienst(text, "worker")).toContain("# - ./eingang:/var/lib/belegt/eingang");
  });

  it("nennt denselben Bereich im Containerfile", () => {
    expect(lesen("deploy/ftp/Containerfile")).toContain(`EXPOSE 21 ${von}-${bis}`);
  });
});
