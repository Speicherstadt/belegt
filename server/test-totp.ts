import { createHmac } from "node:crypto";

/*
 * TOTP nach RFC 6238 (HMAC-SHA1, 6 Stellen, 30 Sekunden) für Tests und E2E: rechnet den Code aus der Adresse, die
 * /api/auth/two-factor/enable liefert, unabhängig von Better Auth. https://www.rfc-editor.org/rfc/rfc6238
 */

/** Base32 nach RFC 4648 ohne Auffüllung, etwa der Schlüssel zum Abtippen */
export function base32(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const z of text.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(z).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => Number.parseInt(b, 2)));
}

/** Das Geheimnis aus otpauth://totp/…?secret=… */
export const geheimnisAus = (uri: string) => base32(new URL(uri).searchParams.get("secret") ?? "");

/** Der Code zum Zeitpunkt (Millisekunden) */
export function totpCode(geheimnis: Buffer, zeit = Date.now()): string {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(Math.floor(zeit / 30_000)));
  const hmac = createHmac("sha1", geheimnis).update(zaehler).digest();
  const versatz = hmac[hmac.length - 1]! & 0x0f;
  const zahl = (hmac.readUInt32BE(versatz) & 0x7fffffff) % 1_000_000;
  return String(zahl).padStart(6, "0");
}
