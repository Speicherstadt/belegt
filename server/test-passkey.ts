import { createHash, createSign, generateKeyPairSync, type KeyObject, randomBytes } from "node:crypto";

/*
 * Ein Authenticator in Software für Tests gegen Postgres: erzeugt Antworten nach WebAuthn Level 2 (Registrierung mit
 * Attestierung „none“, Anmeldung mit ES256), wie sie der Browser aus navigator.credentials liefert. Im Browser übernimmt
 * das der virtuelle Authenticator von Chromium (e2e/konto.spec.ts).
 * https://www.w3.org/TR/webauthn-2/#sctn-attestation, https://www.rfc-editor.org/rfc/rfc8152#section-13.1.1
 */

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { [k: string]: Cbor };

/** Kleinster CBOR-Kodierer für das, was ein Authenticator schreibt (RFC 8949) */
function cbor(wert: Cbor): Buffer {
  const kopf = (art: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(art << 5) | n]);
    if (n < 256) return Buffer.from([(art << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (art << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof wert === "number") return wert >= 0 ? kopf(0, wert) : kopf(1, -1 - wert);
  if (typeof wert === "string") return Buffer.concat([kopf(3, Buffer.byteLength(wert)), Buffer.from(wert)]);
  if (wert instanceof Uint8Array) return Buffer.concat([kopf(2, wert.length), Buffer.from(wert)]);
  if (Array.isArray(wert)) return Buffer.concat([kopf(4, wert.length), ...wert.map(cbor)]);
  const eintraege = wert instanceof Map ? [...wert.entries()] : Object.entries(wert);
  return Buffer.concat([kopf(5, eintraege.length), ...eintraege.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

export interface SoftwarePasskey {
  /** Antwort auf die Optionen aus /passkey/generate-register-options */
  registrieren(optionen: { challenge: string; rp: { id: string } }): Record<string, unknown>;
  /** Antwort auf die Optionen aus /passkey/generate-authenticate-options */
  anmelden(optionen: { challenge: string; rpId: string }): Record<string, unknown>;
}

export function softwarePasskey(origin: string): SoftwarePasskey {
  const { privateKey, publicKey }: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const id = randomBytes(16);
  let zaehler = 0;
  const jwk = publicKey.export({ format: "jwk" });
  const coseKey = new Map<Cbor, Cbor>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x!, "base64url")],
    [-3, Buffer.from(jwk.y!, "base64url")],
  ]);

  /** rpIdHash, Flags (UP, UV, bei der Registrierung AT), Zähler, bei der Registrierung die Schlüsseldaten */
  function authData(rpId: string, mitSchluessel: boolean): Buffer {
    zaehler += 1;
    const z = Buffer.alloc(4);
    z.writeUInt32BE(zaehler);
    const teile: Buffer[] = [sha256(rpId), Buffer.from([mitSchluessel ? 0x45 : 0x05]), z];
    if (mitSchluessel) {
      const laenge = Buffer.alloc(2);
      laenge.writeUInt16BE(id.length);
      teile.push(Buffer.alloc(16), laenge, id, cbor(coseKey));
    }
    return Buffer.concat(teile);
  }

  const clientData = (type: string, challenge: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    registrieren(optionen) {
      const daten = clientData("webauthn.create", optionen.challenge);
      const attestation = cbor({ fmt: "none", attStmt: {}, authData: authData(optionen.rp.id, true) });
      return {
        id: b64url(id),
        rawId: b64url(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(daten),
          attestationObject: b64url(attestation),
          transports: ["internal"],
        },
      };
    },
    anmelden(optionen) {
      const daten = clientData("webauthn.get", optionen.challenge);
      const auth = authData(optionen.rpId, false);
      const signatur = createSign("sha256")
        .update(Buffer.concat([auth, sha256(daten)]))
        .sign(privateKey);
      return {
        id: b64url(id),
        rawId: b64url(id),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(daten),
          authenticatorData: b64url(auth),
          signature: b64url(signatur),
        },
      };
    },
  };
}
