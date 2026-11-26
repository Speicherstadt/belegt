import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { nachFristende, sperrenAbgleichen } from "./objektsperren.ts";
import { type S3Konfig, s3Speicher } from "./s3.ts";

/** Nachgebauter S3-Server mit Versionen und Object Lock im Modus COMPLIANCE, wie AWS ihn durchsetzt */
async function s3Server() {
  const objekte = new Map<string, { id: string; bytes: Buffer; sperre: number }[]>();
  const anfragen: { methode: string; pfad: string; kopf: Record<string, string | string[] | undefined> }[] = [];
  let n = 0;
  const server: Server = createServer((req, res) => {
    const teile: Buffer[] = [];
    req.on("data", (t: Buffer) => teile.push(t));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://s3");
      const body = Buffer.concat(teile);
      anfragen.push({ methode: req.method ?? "", pfad: url.pathname + url.search, kopf: req.headers });
      const fehler = (status: number, code: string) => {
        res.statusCode = status;
        res.end(`<Error><Code>${code}</Code><Message>geheim-123</Message></Error>`);
      };
      if (!String(req.headers.authorization).startsWith("AWS4-HMAC-SHA256 Credential=schluessel/"))
        return fehler(403, "SignatureDoesNotMatch");
      const [, bucket, ...rest] = url.pathname.split("/");
      if (bucket !== "archiv") return fehler(404, "NoSuchBucket");
      const key = rest.join("/");
      const versionen = objekte.get(key) ?? [];
      const aktuell = versionen.at(-1);
      if (req.method === "GET" && url.searchParams.has("versions")) {
        const prefix = url.searchParams.get("prefix") ?? "";
        const liste = [...objekte]
          .filter(([k]) => k.startsWith(prefix))
          .flatMap(([k, vs]) => vs.map((v) => `<Version><Key>${k}</Key><VersionId>${v.id}</VersionId></Version>`));
        return res.end(`<ListVersionsResult>${liste.join("")}</ListVersionsResult>`);
      }
      if (req.method === "HEAD" || (req.method === "GET" && !url.search)) {
        if (!aktuell) return fehler(404, "NoSuchKey");
        return res.end(req.method === "HEAD" ? undefined : aktuell.bytes);
      }
      if (req.method === "PUT" && url.searchParams.has("retention")) {
        if (!aktuell) return fehler(404, "NoSuchKey");
        if (req.headers["content-md5"] !== createHash("md5").update(body).digest("base64"))
          return fehler(400, "BadDigest");
        const bis = Date.parse(/<RetainUntilDate>([^<]+)</.exec(body.toString())?.[1] ?? "");
        // Wie AWS: eine Sperre bis in die Vergangenheit lehnt der Server ab
        if (bis <= Date.now()) return fehler(400, "InvalidArgument");
        if (bis < aktuell.sperre) return fehler(403, "AccessDenied");
        aktuell.sperre = bis;
        return res.end();
      }
      if (req.method === "PUT") {
        if (req.headers["content-md5"] !== createHash("md5").update(body).digest("base64"))
          return fehler(400, "BadDigest");
        if (req.headers["x-amz-checksum-sha256"] !== createHash("sha256").update(body).digest("base64"))
          return fehler(400, "BadDigest");
        const sperre = req.headers["x-amz-object-lock-retain-until-date"];
        versionen.push({ id: `v${++n}`, bytes: body, sperre: sperre ? Date.parse(String(sperre)) : 0 });
        objekte.set(key, versionen);
        return res.end();
      }
      if (req.method === "DELETE") {
        const v = versionen.find((x) => x.id === url.searchParams.get("versionId"));
        if (!v) return fehler(404, "NoSuchVersion");
        if (v.sperre > Date.now()) return fehler(403, "AccessDenied");
        objekte.set(
          key,
          versionen.filter((x) => x !== v),
        );
        return res.end();
      }
      fehler(400, "NotImplemented");
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { objekte, anfragen, server, endpunkt: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const konfig = (endpunkt: string): S3Konfig => ({
  endpunkt,
  bucket: "archiv",
  region: "eu-central-1",
  zugangId: "schluessel",
  zugangGeheimnis: "geheim",
  pfadStil: true,
  sperreTage: 30,
});

const schluessel = (sha: string) => `${sha.slice(0, 2)}/${sha}`;

describe("S3 mit Object Lock", () => {
  let s: Awaited<ReturnType<typeof s3Server>>;
  let k: S3Konfig;
  beforeAll(async () => {
    s = await s3Server();
    k = konfig(s.endpunkt);
  });
  afterAll(() => new Promise<void>((ok) => s.server.close(() => ok())));

  it("lädt signiert mit Prüfsumme und Sperre hoch, liest geprüft und lädt Gleiches nicht noch einmal", async () => {
    const speicher = s3Speicher(k);
    const bytes = new TextEncoder().encode("%PDF-1.7\n% Rechnung\n");
    const sha = await speicher.speichern(bytes);
    const put = s.anfragen.find((a) => a.methode === "PUT")!;
    expect(put.kopf["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
    expect(Date.parse(String(put.kopf["x-amz-object-lock-retain-until-date"]))).toBeGreaterThan(
      Date.now() + 29 * 86_400_000,
    );
    expect(new TextDecoder().decode(await speicher.laden(sha))).toBe("%PDF-1.7\n% Rechnung\n");
    await speicher.speichern(bytes);
    expect(s.anfragen.filter((a) => a.methode === "PUT")).toHaveLength(1);
    expect(speicher.pfad(sha)).toBe(`s3://archiv/${schluessel(sha)}`);
  });

  it("meldet eine fehlende Datei wie das Dateisystem und eine veränderte als Befund", async () => {
    const speicher = s3Speicher(k);
    await expect(speicher.laden("a".repeat(64))).rejects.toMatchObject({ code: "ENOENT" });
    const sha = await speicher.speichern(new TextEncoder().encode("wird verändert"));
    s.objekte.get(schluessel(sha))!.at(-1)!.bytes = Buffer.from("anders");
    await expect(speicher.laden(sha)).rejects.toThrow("Datei passt nicht zu ihrem Hash");
  });

  it("prüft Dateien gestreamt wie der Dateispeicher des Kerns: ok, fehlt, beschädigt", async () => {
    const speicher = s3Speicher(k);
    const gut = await speicher.speichern(new TextEncoder().encode("bleibt, wie es ist"));
    const schlecht = await speicher.speichern(new TextEncoder().encode("wird später verändert"));
    s.objekte.get(schluessel(schlecht))!.at(-1)!.bytes = Buffer.from("anders");
    const weg = "b".repeat(64);
    expect(await speicher.pruefen(gut)).toBe("ok");
    expect(await speicher.pruefen(schlecht)).toBe("beschädigt");
    expect(await speicher.pruefen(weg)).toBe("fehlt");
    expect(await speicher.pruefenAlle([gut, schlecht, weg])).toEqual({
      dateien: 3,
      befundAnzahl: 2,
      befunde: [
        { sha256: schlecht, befund: "beschädigt" },
        { sha256: weg, befund: "fehlt" },
      ],
    });
    // Eine fehlende Datei, die niemand mehr braucht, ist kein Befund; gezählt wird jeder, genannt höchstens maxBefunde
    expect(await speicher.pruefenAlle([gut, schlecht, weg], { nochGenutzt: async () => false, maxBefunde: 0 })).toEqual(
      { dateien: 3, befundAnzahl: 1, befunde: [] },
    );
  });

  it("verlängert die Sperre und löscht erst nach ihrem Ende, jede Version", async () => {
    const speicher = s3Speicher({ ...k, sperreTage: 0 });
    const sha = await speicher.speichern(new TextEncoder().encode("frist läuft"));
    await speicher.sperren(sha, new Date(Date.now() + 86_400_000));
    // Der Server sagt nur Code und Status weiter, nicht seine Meldung
    await expect(speicher.entfernen(sha)).rejects.toThrow(/^S3 Löschen: 403 AccessDenied$/);
    s.objekte.get(schluessel(sha))!.forEach((v) => {
      v.sperre = Date.now() - 1000;
    });
    await speicher.entfernen(sha);
    expect(s.objekte.get(schluessel(sha))).toEqual([]);
  });

  it("rechnet das Ende der Sperre auf 0 Uhr Berlin nach dem letzten Tag der Frist", () => {
    expect(nachFristende("2034-12-31").toISOString()).toBe("2034-12-31T23:00:00.000Z");
    expect(nachFristende("2030-07-15").toISOString()).toBe("2030-07-15T22:00:00.000Z");
  });
});

describe("S3 mit clientseitiger Verschlüsselung", () => {
  let s: Awaited<ReturnType<typeof s3Server>>;
  const k1 = Buffer.alloc(32, 0x11);
  const k2 = Buffer.alloc(32, 0x22);

  beforeAll(async () => {
    s = await s3Server();
  });
  afterAll(() => new Promise<void>((ok) => s.server.close(() => ok())));

  it("lädt verschlüsselt mit Object Lock und Chiffretext-Prüfsumme hoch und liest/prüft gegen den Klartext-Hash", async () => {
    const speicher = s3Speicher({ ...konfig(s.endpunkt), schluessel: [k1] });
    const klar = new TextEncoder().encode("%PDF-1.7\n% Patientenakte vertraulich\n");
    const sha = await speicher.speichern(klar);
    expect(sha).toBe(createHash("sha256").update(klar).digest("hex"));

    const gespeichert = s.objekte.get(schluessel(sha))!.at(-1)!.bytes;
    expect(gespeichert.includes(Buffer.from("Patientenakte"))).toBe(false);
    expect(gespeichert.subarray(0, 5).equals(Buffer.from([0x42, 0x4c, 0x47, 0x54, 0x01]))).toBe(true);

    const put = s.anfragen.findLast((a) => a.methode === "PUT" && !a.pfad.includes("?retention"))!;
    expect(put.kopf["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
    expect(put.kopf["x-amz-checksum-sha256"]).toBe(createHash("sha256").update(gespeichert).digest("base64"));

    expect(new TextDecoder().decode(await speicher.laden(sha))).toBe("%PDF-1.7\n% Patientenakte vertraulich\n");
    expect(await speicher.pruefen(sha)).toBe("ok");

    // Manipulierter Chiffretext wird beim Laden und Prüfen erkannt
    gespeichert[gespeichert.length - 1] = (gespeichert[gespeichert.length - 1] ?? 0) ^ 0x01;
    expect(await speicher.pruefen(sha)).toBe("beschädigt");
    await expect(speicher.laden(sha)).rejects.toThrow("beschädigt");
  });

  it("unterstützt Schlüsselrotation und meldet fehlenden Schlüssel als nicht lesbar", async () => {
    const alt = s3Speicher({ ...konfig(s.endpunkt), schluessel: [k1], sperreTage: 0 });
    const shaAlt = await alt.speichern(new TextEncoder().encode("Unter Schlüssel 1 gespeichert"));

    const rotiert = s3Speicher({ ...konfig(s.endpunkt), schluessel: [k2, k1], sperreTage: 0 });
    const shaNeu = await rotiert.speichern(new TextEncoder().encode("Unter Schlüssel 2 gespeichert"));
    expect(new TextDecoder().decode(await rotiert.laden(shaAlt))).toBe("Unter Schlüssel 1 gespeichert");
    expect(new TextDecoder().decode(await rotiert.laden(shaNeu))).toBe("Unter Schlüssel 2 gespeichert");
    expect(await rotiert.pruefenAlle([shaAlt, shaNeu])).toEqual({ dateien: 2, befundAnzahl: 0, befunde: [] });

    const nurNeu = s3Speicher({ ...konfig(s.endpunkt), schluessel: [k2], sperreTage: 0 });
    const ergebnis = await nurNeu.pruefenAlle([shaAlt, shaNeu]);
    expect(ergebnis.befundAnzahl).toBe(1);
    expect(ergebnis.befunde[0]).toMatchObject({ sha256: shaAlt, befund: "nicht lesbar" });
  });

  it("nutzt mit pfadHmac stabile HMAC-Objektnamen für Speichern, Sperren, Rotation und Löschen", async () => {
    expect(() => s3Speicher({ ...konfig(s.endpunkt), pfadHmac: true })).toThrow("S3_PFAD_HMAC erfordert S3_SCHLUESSEL");

    const speicher = s3Speicher({ ...konfig(s.endpunkt), schluessel: [k1], pfadHmac: true, sperreTage: 0 });
    const sha = await speicher.speichern(new TextEncoder().encode("Verdeckter Objektname"));
    expect(s.objekte.has(schluessel(sha))).toBe(false);
    const hmacKey = speicher.pfad(sha).replace("s3://archiv/", "");
    expect(hmacKey).not.toBe(schluessel(sha));
    expect(s.objekte.has(hmacKey)).toBe(true);

    // Sperren und Lesen über rotierten Schlüssel nutzen denselben HMAC-Pfad
    await speicher.sperren(sha, new Date(Date.now() + 86_400_000));
    const rotiert = s3Speicher({ ...konfig(s.endpunkt), schluessel: [k2, k1], pfadHmac: true, sperreTage: 0 });
    expect(rotiert.pfad(sha)).toBe(speicher.pfad(sha));
    expect(await rotiert.pruefen(sha)).toBe("ok");

    // Nach Fristende vollständig entfernbar
    s.objekte.get(hmacKey)!.forEach((v) => {
      v.sperre = Date.now() - 1000;
    });
    await rotiert.entfernen(sha);
    expect(s.objekte.get(hmacKey)).toEqual([]);
  });
});

describe.skipIf(!testDatenbankUrl)("Abgleich mit den Fristen gegen Postgres", () => {
  let s: Awaited<ReturnType<typeof s3Server>>;
  let k: S3Konfig;
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  beforeAll(async () => {
    s = await s3Server();
    k = konfig(s.endpunkt);
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await new Promise<void>((ok) => s?.server.close(() => ok()));
  });

  it("sperrt bis zum Fristende, verlängert bei längerer Frist und nur dann", async () => {
    const speicher = s3Speicher({ ...k, sperreTage: 0 });
    const bytes = new TextEncoder().encode("%PDF-1.7\n% Beleg 2026\n");
    await speicher.speichern(bytes);
    const form = new FormData();
    form.append("datei", new File([bytes], "beleg.pdf"));
    const d = await (await t.anfrage("/api/dokumente", { method: "POST", body: form }, cookie)).json();
    await t.anfrage(
      `/api/dokumente/${d.id}/einordnung`,
      json({ art: "geschaeftsbrief", entstanden: "2026-03-01" }),
      cookie,
    );

    expect(await sperrenAbgleichen(t.db, speicher)).toEqual({ gesetzt: 1, fehler: null });
    expect(s.objekte.get(schluessel(d.sha256))!.at(-1)!.sperre).toBe(Date.parse("2032-12-31T23:00:00Z"));
    expect(await sperrenAbgleichen(t.db, speicher)).toEqual({ gesetzt: 0, fehler: null });

    await t.anfrage(`/api/dokumente/${d.id}/einordnung`, json({ art: "buecher", entstanden: "2026-03-01" }), cookie);
    expect(await sperrenAbgleichen(t.db, speicher)).toEqual({ gesetzt: 1, fehler: null });
    expect(s.objekte.get(schluessel(d.sha256))!.at(-1)!.sperre).toBe(Date.parse("2036-12-31T23:00:00Z"));
    expect(await t.sql`select bis::text from objektsperren`).toEqual([{ bis: "2036-12-31" }]);
  });

  it("sperrt nichts, dessen Frist schon abgelaufen ist, und versucht es nicht jede Minute neu", async () => {
    const speicher = s3Speicher({ ...k, sperreTage: 0 });
    const bytes = new TextEncoder().encode("%PDF-1.7\n% Altbestand 2010\n");
    await speicher.speichern(bytes);
    const form = new FormData();
    form.append("datei", new File([bytes], "alt.pdf"));
    const d = await (await t.anfrage("/api/dokumente", { method: "POST", body: form }, cookie)).json();
    await t.anfrage(
      `/api/dokumente/${d.id}/einordnung`,
      json({ art: "geschaeftsbrief", entstanden: "2010-03-01" }),
      cookie,
    );
    const vorher = s.anfragen.length;
    expect(await sperrenAbgleichen(t.db, speicher)).toEqual({ gesetzt: 0, fehler: null });
    expect(s.anfragen.slice(vorher).filter((a) => a.pfad.includes("?retention"))).toEqual([]);
  });
});
