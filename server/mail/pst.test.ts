import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { emlLesen } from "./eml.ts";
import { istPst, pstMails } from "./pst.ts";

// Die Beispieldatei, die pst-extractor mitbringt (öffentliche Enron-Daten); geprüft wird nur die Struktur
const BEISPIEL = new URL("../../node_modules/pst-extractor/example/testdata/enron.pst", import.meta.url);
const MIT_PDF = new URL(
  "../../node_modules/pst-extractor/example/testdata/pstextractortestpdf@outlook.com.ost",
  import.meta.url,
);
const da = existsSync(BEISPIEL) && existsSync(MIT_PDF);

describe.skipIf(!da)("Outlook-Datendatei (PST)", { timeout: 60_000 }, () => {
  it("erkennt eine PST und macht aus jeder Mail eine lesbare .eml mit Kopf, Text und Anhängen", async () => {
    const bytes = new Uint8Array(readFileSync(BEISPIEL));
    expect(istPst(bytes)).toBe(true);
    expect(istPst(new TextEncoder().encode("From: x\r\n"))).toBe(false);
    const mails = [...pstMails(bytes)];
    expect(mails.length).toBeGreaterThan(10);
    // Jede .eml ist lesbar; Betreff oder Absender fehlen nur, wo schon die Kopfzeilen im Original keine haben
    const gelesen = await Promise.all(mails.map((roh) => emlLesen(roh)));
    const mitKopf = gelesen.filter((m) => m.betreff || m.von?.adresse).length;
    expect(mitKopf / gelesen.length).toBeGreaterThan(0.95);
    // Dieselbe PST ergibt dieselben .eml, Byte für Byte
    expect([...pstMails(bytes)].map((m) => Buffer.from(m).toString("base64"))).toEqual(
      mails.map((m) => Buffer.from(m).toString("base64")),
    );
  });

  it("übernimmt Anhänge (OST mit PDF)", async () => {
    const mails = [...pstMails(new Uint8Array(readFileSync(MIT_PDF)))];
    const anhaenge = (await Promise.all(mails.map((r) => emlLesen(r)))).flatMap((m) => m.anhaenge);
    const pdf = anhaenge.find((a) => a.dateiname?.toLowerCase().endsWith(".pdf"));
    expect(pdf).toBeTruthy();
    expect(Buffer.from(pdf!.bytes).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe.skipIf(!da || !testDatenbankUrl)("PST-Import gegen Postgres", { timeout: 120_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("legt die PST als Original ab und jede Mail daraus als eigenes Dokument, beim zweiten Mal nicht doppelt", async () => {
    const form = () => {
      const f = new FormData();
      f.append("datei", new File([readFileSync(BEISPIEL)], "postfach.pst"));
      return f;
    };
    const erst = await (await t.anfrage("/api/mails", { method: "POST", body: form() }, cookie)).json();
    expect(erst.neu.length).toBeGreaterThan(10);
    const pst = await (await t.anfrage(`/api/dokumente/${erst.pst}`, {}, cookie)).json();
    expect(pst).toMatchObject({ dateiname: "postfach.pst", quelle: "upload" });
    const datei = new Uint8Array(await (await t.anfrage(`/api/dokumente/${erst.pst}/datei`, {}, cookie)).arrayBuffer());
    expect(Buffer.from(datei).equals(readFileSync(BEISPIEL))).toBe(true);

    const zweit = await (await t.anfrage("/api/mails", { method: "POST", body: form() }, cookie)).json();
    expect(zweit.neu).toEqual([]);
    expect(zweit.doppelt.length).toBe(erst.neu.length + erst.doppelt.length);
  });
});
