import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  type DecipherGCM,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/*
 * Clientseitige Verschlüsselung für Originale in S3 (Envelope Encryption mit AES-256-GCM nach NIST SP 800-38D,
 * Pfad-Ableitung mit HKDF-SHA256 nach RFC 5869 und HMAC-SHA256 nach RFC 2104):
 *   Kopf (85 Bytes): Magie "BLGT\x01" (5) | Key-ID (8) | Wrap-IV (12) | Wrap-Tag (16) | Wrapped-DEK (32) | Daten-IV (12)
 *   danach:          Chiffretext (N Bytes) | Daten-Tag (16 Bytes)
 *
 * Jedes Objekt bekommt einen eigenen 256-Bit-Datenschlüssel (DEK), geschützt mit dem aktiven Hauptschlüssel (KEK).
 * Der gesamte Kopf geht als AAD in die Nutzdaten-Verschlüsselung ein; der Daten-Tag steht am Ende, damit die Prüfung
 * (dateiPruefen) gestreamt und mit konstantem Speicher entschlüsseln und hashen kann.
 */
const MAGIE = Buffer.from([0x42, 0x4c, 0x47, 0x54, 0x01]);
const KEY_ID_LAENGE = 8;
const IV_LAENGE = 12;
const TAG_LAENGE = 16;
const DEK_LAENGE = 32;
const KOPF_LAENGE = MAGIE.length + KEY_ID_LAENGE + IV_LAENGE + TAG_LAENGE + DEK_LAENGE + IV_LAENGE;
const PFAD_INFO = Buffer.from("belegt-s3-pfad-v1");

const fehlerMitCode = (nachricht: string, code: "S3_BESCHAEDIGT" | "S3_KEY_UNKNOWN") =>
  Object.assign(new Error(nachricht), { code });

const schluesselId = (kek: Buffer) => createHash("sha256").update(kek).digest().subarray(0, KEY_ID_LAENGE);

const BASE64_32 = /^[A-Za-z0-9+/]{43}=?$/;

/** Liest einen oder mehrere (mit Komma getrennte) 32-Byte-Schlüssel aus base64; der erste schreibt, alle lesen */
export function s3SchluesselAus(text: string): Buffer[] {
  const teile = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (teile.length === 0)
    throw new Error(
      "S3_SCHLUESSEL muss mindestens einen 32-Byte-Schlüssel (base64) enthalten, etwa aus openssl rand -base64 32",
    );
  return teile.map((b64) => {
    const k = BASE64_32.test(b64) ? Buffer.from(b64, "base64") : null;
    if (!k || k.length !== DEK_LAENGE || k.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, ""))
      throw new Error(
        "Jeder Schlüssel in S3_SCHLUESSEL muss 32 Bytes lang sein (base64), etwa aus openssl rand -base64 32",
      );
    return k;
  });
}

/**
 * Leitet den Objekt-Hash per HMAC-SHA256 aus dem ältesten (letzten) Hauptschlüssel ab, damit beim Voranstellen eines
 * neuen Schlüssels für neue Objekte bestehende Pfade im Bucket stabil bleiben.
 */
export function s3PfadHash(schluessel: Buffer[], sha256: string): string {
  const basis = schluessel.at(-1);
  if (!basis) throw new Error("S3_PFAD_HMAC erfordert S3_SCHLUESSEL");
  const pfadKey = Buffer.from(hkdfSync("sha256", basis, Buffer.alloc(0), PFAD_INFO, DEK_LAENGE));
  return createHmac("sha256", pfadKey).update(sha256).digest("hex");
}

export function s3Verschluesseln(kek: Buffer, klar: Uint8Array): Buffer {
  const dek = randomBytes(DEK_LAENGE);
  const keyId = schluesselId(kek);
  const wrapIv = randomBytes(IV_LAENGE);
  const wrapCipher = createCipheriv("aes-256-gcm", kek, wrapIv);
  wrapCipher.setAAD(Buffer.concat([MAGIE, keyId]));
  const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  const dataIv = randomBytes(IV_LAENGE);
  const kopf = Buffer.concat([MAGIE, keyId, wrapIv, wrapTag, wrappedDek, dataIv]);
  const dataCipher = createCipheriv("aes-256-gcm", dek, dataIv);
  dataCipher.setAAD(kopf);
  const chiffrat = Buffer.concat([dataCipher.update(klar), dataCipher.final()]);
  return Buffer.concat([kopf, chiffrat, dataCipher.getAuthTag()]);
}

function kopfOeffnen(schluessel: Buffer[], kopf: Buffer): { dek: Buffer; dataIv: Buffer } {
  if (kopf.length !== KOPF_LAENGE || !kopf.subarray(0, MAGIE.length).equals(MAGIE))
    throw fehlerMitCode("Verschlüsseltes S3-Objekt ist beschädigt oder hat ein unbekanntes Format.", "S3_BESCHAEDIGT");

  const abKeyId = MAGIE.length;
  const abWrapIv = abKeyId + KEY_ID_LAENGE;
  const abWrapTag = abWrapIv + IV_LAENGE;
  const abWrappedDek = abWrapTag + TAG_LAENGE;
  const abDataIv = abWrappedDek + DEK_LAENGE;

  const keyId = kopf.subarray(abKeyId, abWrapIv);
  const wrapIv = kopf.subarray(abWrapIv, abWrapTag);
  const wrapTag = kopf.subarray(abWrapTag, abWrappedDek);
  const wrappedDek = kopf.subarray(abWrappedDek, abDataIv);
  const dataIv = kopf.subarray(abDataIv, KOPF_LAENGE);

  const kek = schluessel.find((k) => schluesselId(k).equals(keyId));
  if (!kek) throw fehlerMitCode("Kein passender S3_SCHLUESSEL zum Entschlüsseln dieses Objekts.", "S3_KEY_UNKNOWN");

  try {
    const unwrap = createDecipheriv("aes-256-gcm", kek, wrapIv, { authTagLength: TAG_LAENGE });
    unwrap.setAAD(kopf.subarray(0, MAGIE.length + KEY_ID_LAENGE));
    unwrap.setAuthTag(wrapTag);
    const dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);
    return { dek, dataIv };
  } catch {
    throw fehlerMitCode("Datenschlüssel des S3-Objekts ist beschädigt.", "S3_BESCHAEDIGT");
  }
}

export function s3Entschluesseln(schluessel: Buffer[], versiegelt: Uint8Array): Buffer {
  const b = Buffer.from(versiegelt);
  if (b.length < KOPF_LAENGE + TAG_LAENGE)
    throw fehlerMitCode("Verschlüsseltes S3-Objekt ist unvollständig.", "S3_BESCHAEDIGT");
  const kopf = b.subarray(0, KOPF_LAENGE);
  const { dek, dataIv } = kopfOeffnen(schluessel, kopf);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, dataIv, { authTagLength: TAG_LAENGE });
    decipher.setAAD(kopf);
    decipher.setAuthTag(b.subarray(b.length - TAG_LAENGE));
    return Buffer.concat([decipher.update(b.subarray(KOPF_LAENGE, b.length - TAG_LAENGE)), decipher.final()]);
  } catch {
    throw fehlerMitCode("Verschlüsseltes S3-Objekt ist beschädigt.", "S3_BESCHAEDIGT");
  }
}

/** Entschlüsselt einen S3-Antwortstream mit konstantem Speicher und vergleicht den Klartext-Hash */
export async function s3PruefenStream(
  schluessel: Buffer[],
  stream: ReadableStream<Uint8Array> | null,
  erwartetSha256: string,
): Promise<"ok" | "beschädigt"> {
  if (!stream) return "beschädigt";
  const kopfTeile: Buffer[] = [];
  let kopfGelesen = 0;
  let decipher: DecipherGCM | null = null;
  const hash = createHash("sha256");
  let rest = Buffer.alloc(0);

  const verarbeite = (teil: Buffer) => {
    if (!decipher || teil.length === 0) return;
    const gesamt = rest.length > 0 ? Buffer.concat([rest, teil]) : teil;
    if (gesamt.length > TAG_LAENGE) {
      hash.update(decipher.update(gesamt.subarray(0, gesamt.length - TAG_LAENGE)));
      rest = Buffer.from(gesamt.subarray(gesamt.length - TAG_LAENGE));
    } else {
      rest = Buffer.from(gesamt);
    }
  };

  for await (const roh of stream) {
    const teil = Buffer.from(roh);
    if (!decipher) {
      const fehlt = KOPF_LAENGE - kopfGelesen;
      if (teil.length < fehlt) {
        kopfTeile.push(teil);
        kopfGelesen += teil.length;
        continue;
      }
      kopfTeile.push(teil.subarray(0, fehlt));
      const kopf = Buffer.concat(kopfTeile);
      let offen: { dek: Buffer; dataIv: Buffer };
      try {
        offen = kopfOeffnen(schluessel, kopf);
      } catch (err) {
        if ((err as { code?: string }).code === "S3_BESCHAEDIGT") return "beschädigt";
        throw err;
      }
      decipher = createDecipheriv("aes-256-gcm", offen.dek, offen.dataIv, { authTagLength: TAG_LAENGE });
      decipher.setAAD(kopf);
      verarbeite(teil.subarray(fehlt));
    } else {
      verarbeite(teil);
    }
  }

  if (!decipher || rest.length !== TAG_LAENGE) return "beschädigt";
  try {
    decipher.setAuthTag(rest);
    hash.update(decipher.final());
  } catch {
    return "beschädigt";
  }
  return hash.digest("hex") === erwartetSha256 ? "ok" : "beschädigt";
}
