/**
 * Der Caddy-Block für HTTPS steht dreimal: in deploy/Caddyfile (Vorlage für einen eigenen Caddy) und inline in
 * deploy/compose.yml und compose.yml (Profil https), weil man compose.yml auch allein herunterlädt. Ändert sich ein
 * Header nur an einer Stelle, liefen sie ohne Meldung auseinander; deshalb ein Vergleich statt einer gemeinsamen Datei.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const wurzel = join(import.meta.dirname, "..");

/**
 * Der Block ohne das, was je Ort abweichen darf: Domain in der ersten Zeile, Ziel von reverse_proxy, Einrückung (Tabs
 * im Caddyfile, Leerzeichen im YAML), Kommentare und leere Zeilen.
 */
function inhalt(block: string): string[] {
  return block
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "" && !z.startsWith("#"))
    .map((z, i) =>
      i === 0 ? z.replace(/^\S+ \{$/, "<domain> {") : z.replace(/^reverse_proxy \S+$/, "reverse_proxy <ziel>"),
    );
}

/** Der Inhalt von configs.caddyfile.content: die Zeilen nach `content: |`, solange sie tiefer eingerückt sind */
function ausCompose(datei: string): string {
  const text = readFileSync(join(wurzel, datei), "utf8");
  const anfang = "\n  caddyfile:\n    content: |\n";
  expect(text).toContain(anfang);
  const zeilen = text.slice(text.indexOf(anfang) + anfang.length).split("\n");
  const ende = zeilen.findIndex((z) => z !== "" && !z.startsWith("      "));
  return zeilen.slice(0, ende).join("\n");
}

describe("Caddy-Block für HTTPS", () => {
  const vorlage = inhalt(readFileSync(join(wurzel, "deploy/Caddyfile"), "utf8"));

  it.each(["deploy/compose.yml", "compose.yml"])("ist in %s derselbe wie in deploy/Caddyfile", (datei) => {
    expect(inhalt(ausCompose(datei))).toEqual(vorlage);
  });

  it("vergleicht wirklich etwas: HSTS, Kompression und Ziel stehen im Block", () => {
    expect(vorlage[0]).toBe("<domain> {");
    expect(vorlage.join("\n")).toContain("Strict-Transport-Security");
    expect(vorlage).toContain("encode zstd gzip");
    expect(vorlage).toContain("reverse_proxy <ziel>");
  });

  // HSTS gilt für den Hostnamen auf allen Ports; für localhost (Compose ohne DOMAIN) erzwänge es ein Jahr lang HTTPS
  // auch für andere Programme auf diesem Rechner, includeSubDomains dazu für jede Subdomain
  it("setzt HSTS mit includeSubDomains nur für eine echte Domain, nie für localhost", () => {
    expect(vorlage).toContain("@domain not host localhost");
    expect(vorlage).toContain('header @domain Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(vorlage.filter((z) => z.includes("Strict-Transport-Security"))).toHaveLength(1);
  });

  it("setzt keinen eigenen Schutz gegen Rahmen: den setzt Belegt nach BELEGT_EMBED_ORIGIN (server/http/statisch.ts)", () => {
    expect(vorlage.join("\n")).not.toMatch(/X-Frame-Options|frame-ancestors/);
  });

  // Der Server nimmt X-Forwarded-For nur von BELEGT_TRUSTED_PROXIES (server/http/client-ip.ts)
  it.each(["deploy/compose.yml", "compose.yml"])("vertraut in %s nur der festen Adresse von Caddy", (datei) => {
    const text = readFileSync(join(wurzel, datei), "utf8");
    expect(text).toContain(`BELEGT_TRUSTED_PROXIES: \${BELEGT_TRUSTED_PROXIES:-172.31.250.2}`);
    expect(text).toMatch(/\n {2}caddy:\n(?: {4}.*\n)*? {4}networks:\n {6}proxy:\n {8}ipv4_address: 172\.31\.250\.2\n/);
    // Andere Container bekommen ihre Adresse außerhalb davon, das Gateway ist .1
    expect(text).toContain("- subnet: 172.31.250.0/29\n          ip_range: 172.31.250.4/30");
  });

  it("leitet in Compose an den Dienst server und nimmt die Domain aus DOMAIN", () => {
    for (const datei of ["deploy/compose.yml", "compose.yml"]) {
      const block = ausCompose(datei);
      expect(block).toContain("reverse_proxy server:3000");
      expect(block.trimStart().startsWith(`\${DOMAIN:-localhost} {`)).toBe(true);
    }
  });
});
