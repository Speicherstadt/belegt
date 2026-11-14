import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/*
 * AES-256-GCM für Geheimnisse in der Datenbank (Spalte ciphertext), wie in Haben (apps/web/src/server/crypto.ts):
 * Ergebnis IV | Tag | Chiffrat. Der Schlüssel kommt aus BELEGT_SCHLUESSEL (32 Bytes, base64) und nie in die Datenbank.
 */
const IV_LAENGE = 12;
const TAG_LAENGE = 16;

export function schluesselAus(base64: string): Buffer {
  const schluessel = Buffer.from(base64, "base64");
  if (schluessel.length !== 32)
    throw new Error("BELEGT_SCHLUESSEL muss 32 Bytes lang sein (base64), etwa aus openssl rand -base64 32");
  return schluessel;
}

export function verschluesseln(schluessel: Buffer, klar: Uint8Array): Buffer {
  const iv = randomBytes(IV_LAENGE);
  const cipher = createCipheriv("aes-256-gcm", schluessel, iv);
  const inhalt = Buffer.concat([cipher.update(klar), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), inhalt]);
}

export function entschluesseln(schluessel: Buffer, versiegelt: Uint8Array): Buffer {
  const b = Buffer.from(versiegelt);
  // Ein gekürzter Tag ließe sich mit wenigen Versuchen fälschen
  if (b.length < IV_LAENGE + TAG_LAENGE) throw new Error("Verschlüsselter Wert ist unvollständig.");
  const decipher = createDecipheriv("aes-256-gcm", schluessel, b.subarray(0, IV_LAENGE), { authTagLength: TAG_LAENGE });
  decipher.setAuthTag(b.subarray(IV_LAENGE, IV_LAENGE + TAG_LAENGE));
  return Buffer.concat([decipher.update(b.subarray(IV_LAENGE + TAG_LAENGE)), decipher.final()]);
}
