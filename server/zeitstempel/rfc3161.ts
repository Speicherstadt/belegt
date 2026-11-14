import { randomBytes } from "node:crypto";
import {
  BOOLEAN,
  type Element,
  element,
  GENERALIZED_TIME,
  ganzzahl,
  INTEGER,
  kinder,
  lesen,
  NULL,
  OCTET_STRING,
  oid,
  oidText,
  SEQUENCE,
} from "./der.ts";

/**
 * Zeitstempel nach RFC 3161: Belegt schickt den SHA-256 eines Werts an einen Zeitstempeldienst (TSA) und bekommt ein
 * von ihm signiertes Token zurück, das Wert und Zeit bindet. Belegt prüft, dass das Token zur Anfrage passt (Hash,
 * Nonce, Status); die Signatur prüft, wer das Token später vorlegt, etwa mit `openssl ts -verify` (docs/pruefung.md).
 */

const SHA256 = "2.16.840.1.101.3.4.2.1";
const TST_INFO = "1.2.840.113549.1.9.16.1.4";

export interface Zeitstempel {
  /** Das ganze Token (CMS SignedData, DER) */
  token: Uint8Array;
  /** Zeit laut Dienst (genTime) */
  zeit: Date;
  seriennummer: string;
}

/** TimeStampReq (RFC 3161, 2.4.1) mit Nonce, Zertifikat des Dienstes im Token erbeten */
export function anfrage(hash: Uint8Array, nonce: Uint8Array): Uint8Array {
  if (hash.length !== 32) throw new Error("SHA-256 erwartet");
  return element(
    SEQUENCE,
    ganzzahl(Uint8Array.of(1)),
    element(SEQUENCE, element(SEQUENCE, oid(SHA256), element(NULL)), element(OCTET_STRING, hash)),
    ganzzahl(nonce),
    element(BOOLEAN, Uint8Array.of(0xff)),
  );
}

const ganzeZahl = (e: Element) =>
  Buffer.from(e.inhalt)
    .toString("hex")
    .replace(/^(00)+(?=.)/, "");

/** GeneralizedTime wie 20261114103000Z oder 20261114103000.123Z */
function zeitLesen(e: Element): Date {
  const t = Buffer.from(e.inhalt).toString("ascii");
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/.exec(t);
  if (!m) throw new Error(`Zeitstempel: Zeit nicht lesbar (${t})`);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${(m[7] ?? "0").padEnd(3, "0").slice(0, 3)}Z`);
}

/** Liest die Antwort (TimeStampResp), prüft Status, Hash und Nonce und gibt das Token zurück */
export function antwortLesen(antwort: Uint8Array, hash: Uint8Array, nonce: Uint8Array): Zeitstempel {
  const resp = lesen(antwort);
  const [status, token] = kinder(resp);
  const code = status ? kinder(status)[0] : undefined;
  if (!code || code.tag !== INTEGER) throw new Error("Zeitstempel: Antwort nicht lesbar");
  const wert = code.inhalt[code.inhalt.length - 1];
  // 0 granted, 1 grantedWithMods; alles andere ist eine Ablehnung (RFC 3161, 2.4.2)
  if (code.inhalt.length !== 1 || (wert !== 0 && wert !== 1)) throw new Error(`Zeitstempel abgelehnt (Status ${wert})`);
  if (!token) throw new Error("Zeitstempel: kein Token");

  // ContentInfo → [0] SignedData → encapContentInfo → [0] OCTET STRING mit TSTInfo
  const [typ, explizit] = kinder(token);
  if (!typ || !explizit) throw new Error("Zeitstempel: Token nicht lesbar");
  const signedData = kinder(explizit)[0]!;
  const encap = kinder(signedData).find(
    (k) => k.tag === SEQUENCE && kinder(k)[0] && oidText(kinder(k)[0]!) === TST_INFO,
  );
  if (!encap) throw new Error("Zeitstempel: kein TSTInfo");
  const oktette = kinder(kinder(encap)[1]!)[0]!;
  const tstInfo = kinder(lesen(oktette.inhalt));
  const [, , imprint, serien, genTime, ...rest] = tstInfo;
  if (!imprint || !serien || !genTime || genTime.tag !== GENERALIZED_TIME)
    throw new Error("Zeitstempel: TSTInfo unvollständig");
  const [algorithmus, gehasht] = kinder(imprint);
  if (
    !algorithmus ||
    oidText(kinder(algorithmus)[0]!) !== SHA256 ||
    !gehasht ||
    !Buffer.from(gehasht.inhalt).equals(hash)
  )
    throw new Error("Zeitstempel: gilt nicht für diesen Hash");
  const n = rest.find((k) => k.tag === INTEGER);
  if (
    !n ||
    ganzeZahl(n) !==
      Buffer.from(nonce)
        .toString("hex")
        .replace(/^(00)+(?=.)/, "")
  )
    throw new Error("Zeitstempel: Nonce passt nicht");
  return { token: token.roh, zeit: zeitLesen(genTime), seriennummer: ganzeZahl(serien) };
}

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

/** Fragt den Dienst unter `url` nach einem Zeitstempel für `hash` */
export async function zeitstempelHolen(
  url: string,
  hash: Uint8Array,
  abfragen: Abfragen = fetch,
): Promise<Zeitstempel> {
  const nonce = randomBytes(8);
  const res = await abfragen(url, {
    method: "POST",
    headers: { "content-type": "application/timestamp-query", accept: "application/timestamp-reply" },
    body: new Uint8Array(anfrage(hash, nonce)),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Zeitstempel: Antwort ${res.status}`);
  return antwortLesen(new Uint8Array(await res.arrayBuffer()), hash, nonce);
}
