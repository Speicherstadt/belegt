import { createHash } from "node:crypto";
import type { Dateispeicher, PruefenAlleErgebnis } from "@firsttris/gobd-kern/dateispeicher";
import { sha256Of } from "@firsttris/gobd-kern/dateispeicher";
import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";
import { s3Entschluesseln, s3PfadHash, s3PruefenStream, s3Verschluesseln } from "./s3-krypto.ts";

/**
 * Dateien in einem S3-Bucket mit Object Lock (AWS S3, Ceph, Garage, MinIO …): Schlüssel wie im Dateisystem
 * (ab/abcdef… oder mit pfadHmac als HMAC-SHA256), Prüfsumme SHA-256 beim Hochladen, die Datei beim Lesen gegen ihren
 * Klartext-Hash geprüft. Optional verschlüsselt Belegt jedes Original vor dem Hochladen clientseitig (s3-krypto.ts).
 * Eine Sperre im Modus COMPLIANCE kann niemand verkürzen oder aufheben, auch nicht mit dem Schlüssel des Kontos;
 * Belegt verlängert sie bis zum Fristende (objektsperren.ts). Der Bucket muss mit Object Lock angelegt sein.
 */

export interface S3Konfig {
  /** Basis-Adresse, etwa https://s3.eu-central-1.amazonaws.com oder http://garage:3900 */
  endpunkt: string;
  bucket: string;
  region: string;
  zugangId: string;
  zugangGeheimnis: string;
  /** Bucket im Pfad (http://host/bucket/key) statt als Subdomain; die meisten selbst betriebenen Server wollen das */
  pfadStil: boolean;
  /** Sperre ab dem Hochladen in Tagen, bevor ein Dokument eingeordnet ist; 0: erst mit der Einordnung */
  sperreTage: number;
  /** Optional: 32-Byte-Hauptschlüssel für clientseitige Verschlüsselung (erster schreibt, alle lesen) */
  schluessel?: Buffer[];
  /** Optional: Objektnamen als HMAC-SHA256 statt Klartext-Hash (erfordert schluessel) */
  pfadHmac?: boolean;
}

export interface SperrbarerSpeicher extends Dateispeicher {
  /** Verlängert die Sperre der Datei bis zu diesem Zeitpunkt (verkürzen geht im Modus COMPLIANCE nicht) */
  sperren(sha256: string, bis: Date): Promise<void>;
}

export type Abfragen = (url: string, init: RequestInit) => Promise<Response>;

const xml = new XMLParser({ removeNSPrefix: true, parseTagValue: false, processEntities: false });

const md5 = (b: Uint8Array | string) => createHash("md5").update(b).digest("base64");

/** Fehler wie vom Dateisystem, damit die Prüfung „Datei fehlt“ meldet (dateienPruefen) */
const fehlt = () => Object.assign(new Error("Datei fehlt"), { code: "ENOENT" });

function objektSchluessel(k: S3Konfig, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Ungültiger Hash");
  const name = k.pfadHmac && k.schluessel ? s3PfadHash(k.schluessel, sha256) : sha256;
  return `${name.slice(0, 2)}/${name}`;
}

function hochladenDaten(k: S3Konfig, bytes: Uint8Array, sha256: string) {
  const aktiv = k.schluessel?.[0];
  const nutzlast = aktiv ? s3Verschluesseln(aktiv, bytes) : bytes;
  const pruefsumme = aktiv ? sha256Of(nutzlast) : sha256;
  const kopf: Record<string, string> = {
    "content-type": "application/octet-stream",
    // Der Server prüft den Inhalt selbst; Object Lock verlangt eine Prüfsumme
    "content-md5": md5(nutzlast),
    "x-amz-sdk-checksum-algorithm": "SHA256",
    "x-amz-checksum-sha256": Buffer.from(pruefsumme, "hex").toString("base64"),
  };
  if (k.sperreTage > 0) {
    kopf["x-amz-object-lock-mode"] = "COMPLIANCE";
    kopf["x-amz-object-lock-retain-until-date"] = new Date(Date.now() + k.sperreTage * 86_400_000).toISOString();
  }
  return { kopf, body: new Uint8Array(nutzlast) };
}

export function s3Speicher(k: S3Konfig, abfragen: Abfragen = fetch): SperrbarerSpeicher {
  if (k.pfadHmac && !k.schluessel?.length) throw new Error("S3_PFAD_HMAC erfordert S3_SCHLUESSEL");
  const aws = new AwsClient({
    accessKeyId: k.zugangId,
    secretAccessKey: k.zugangGeheimnis,
    region: k.region,
    service: "s3",
  });
  const basis = new URL(k.endpunkt);
  const schluessel = (sha256: string) => objektSchluessel(k, sha256);
  const adresse = (key: string, abfrage = "") => {
    const u = k.pfadStil
      ? new URL(`/${k.bucket}/${key}`, basis)
      : new URL(`/${key}`, `${basis.protocol}//${k.bucket}.${basis.host}`);
    return `${u.toString()}${abfrage}`;
  };
  async function senden(url: string, init: RequestInit = {}) {
    const signiert = await aws.sign(url, init);
    return abfragen(signiert.url, {
      method: signiert.method,
      headers: signiert.headers,
      ...(init.body ? { body: init.body } : {}),
    });
  }
  const pruefen = async (res: Response, was: string) => {
    if (res.ok) return res;
    // Nur Code und Status, nicht der ganze Text: der kann Kennungen des Kontos enthalten
    const code = /<Code>([^<]+)<\/Code>/.exec(await res.text().catch(() => ""))?.[1];
    throw new Error(`S3 ${was}: ${res.status}${code ? ` ${code}` : ""}`);
  };

  /** Liest die Datei gestreamt (bei Verschlüsselung entschlüsselt) und vergleicht ihren Klartext-Hash */
  async function dateiPruefen(sha256: string): Promise<"ok" | "fehlt" | "beschädigt"> {
    const res = await senden(adresse(schluessel(sha256)));
    if (res.status === 404) {
      await res.body?.cancel();
      return "fehlt";
    }
    await pruefen(res, "Lesen");
    if (k.schluessel?.length) return s3PruefenStream(k.schluessel, res.body, sha256);
    const hash = createHash("sha256");
    if (res.body) for await (const teil of res.body) hash.update(teil);
    return hash.digest("hex") === sha256 ? "ok" : "beschädigt";
  }

  return {
    pfad: (sha256) => `s3://${k.bucket}/${schluessel(sha256)}`,

    pruefen: dateiPruefen,

    // Wie der Dateispeicher des Kerns: nacheinander, eine Datei, die sich nicht lesen lässt, ist ein Befund
    async pruefenAlle(hashes, { nochGenutzt, maxBefunde = Number.POSITIVE_INFINITY } = {}) {
      const ergebnis: PruefenAlleErgebnis = { dateien: 0, befundAnzahl: 0, befunde: [] };
      for (const sha256 of hashes) {
        ergebnis.dateien++;
        const befund = await dateiPruefen(sha256).then(
          (b) => (b === "ok" ? null : { befund: b }),
          (fehler: unknown) => ({ befund: "nicht lesbar" as const, ursache: String(fehler) }),
        );
        if (!befund || (befund.befund === "fehlt" && nochGenutzt && !(await nochGenutzt(sha256)))) continue;
        ergebnis.befundAnzahl++;
        if (ergebnis.befunde.length < maxBefunde) ergebnis.befunde.push({ sha256, ...befund });
      }
      return ergebnis;
    },

    async speichern(bytes) {
      const sha256 = sha256Of(bytes);
      const key = schluessel(sha256);
      if ((await senden(adresse(key), { method: "HEAD" })).ok) return sha256;
      const { kopf, body } = hochladenDaten(k, bytes, sha256);
      await pruefen(await senden(adresse(key), { method: "PUT", headers: kopf, body }), "Hochladen");
      return sha256;
    },

    async laden(sha256) {
      const res = await senden(adresse(schluessel(sha256)));
      if (res.status === 404) throw fehlt();
      await pruefen(res, "Lesen");
      const roh = Buffer.from(await res.arrayBuffer());
      const bytes = k.schluessel?.length ? s3Entschluesseln(k.schluessel, roh) : roh;
      if (sha256Of(bytes) !== sha256) throw new Error("Datei passt nicht zu ihrem Hash");
      return bytes;
    },

    async entfernen(sha256) {
      const key = schluessel(sha256);
      // Mit Object Lock ist der Bucket versioniert: erst das Löschen jeder Version entfernt die Datei wirklich
      const liste = await pruefen(
        await senden(adresse("", `?versions&prefix=${encodeURIComponent(key)}`).replace(/\/\?/, "?")),
        "Versionen",
      );
      const inhalt = xml.parse(await liste.text()) as {
        ListVersionsResult?: { Version?: unknown; DeleteMarker?: unknown };
      };
      const versionen = [inhalt.ListVersionsResult?.Version, inhalt.ListVersionsResult?.DeleteMarker]
        .flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []))
        .filter((v): v is { Key: string; VersionId: string } => (v as { Key?: string }).Key === key);
      for (const v of versionen)
        await pruefen(
          await senden(adresse(key, `?versionId=${encodeURIComponent(v.VersionId)}`), { method: "DELETE" }),
          "Löschen",
        );
    },

    async sperren(sha256, bis) {
      const body = `<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>${bis.toISOString()}</RetainUntilDate></Retention>`;
      await pruefen(
        await senden(adresse(schluessel(sha256), "?retention"), {
          method: "PUT",
          headers: { "content-type": "application/xml", "content-md5": md5(body) },
          body,
        }),
        "Sperre",
      );
    },
  };
}
