import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { csv } from "./z3.ts";

// Ohne ignoreBOM würde der Decoder das BOM still entfernen, das die Tabellen tragen sollen
const strFromU8 = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe("csv", () => {
  it("setzt BOM, Semikolon, CRLF und Anführungszeichen nach RFC 4180", () => {
    expect(
      csv(
        ["a", "b"],
        [
          ["x;y", 'sagt "hallo"'],
          [1, null],
        ],
      ),
    ).toBe('﻿a;b\r\n"x;y";"sagt ""hallo"""\r\n1;\r\n');
  });
});

describe.skipIf(!testDatenbankUrl)("Z3-Export gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const jahr = heute.slice(0, 4);

  async function hochladen(inhalt: string, name: string, einordnung?: object) {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], name));
    const d = await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json();
    if (einordnung) await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json(einordnung));
    return d as { id: string; sha256: string };
  }

  async function exportieren(cookie: string, von: string, bis: string) {
    const res = await als(cookie)(`/api/export?von=${von}&bis=${bis}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    return unzipSync(new Uint8Array(await res.arrayBuffer()));
  }

  let beleg: { id: string; sha256: string };
  let alt: { id: string };
  let offen: { id: string };
  let geloescht: { id: string };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    beleg = await hochladen("%PDF-1.7\n% Rechnung 42\n", "../../Rechnung;42.pdf", {
      art: "beleg",
      entstanden: `${jahr}-03-01`,
      titel: 'Rechnung "Nr. 42"',
      korrespondent: "Muster GmbH",
    });
    alt = await hochladen("%PDF-1.7\n% alter Beleg\n", "alt.pdf", { art: "beleg", entstanden: "2019-05-01" });
    offen = await hochladen("noch nicht eingeordnet", "eingang.txt");
    geloescht = await hochladen("frei abgelegt", "frei.txt", { art: "frei", entstanden: `${jahr}-02-01` });
    expect((await als(inhaber)(`/api/dokumente/${geloescht.id}/loeschung`, { method: "POST" })).status).toBe(201);
  });
  afterAll(() => t?.aufraeumen());

  it("liefert Originale, CSVs, index.xml, Prüfwert und Prüfsummen für den Zeitraum", async () => {
    const zip = await exportieren(inhaber, `${jahr}-01-01`, `${jahr}-12-31`);
    const namen = Object.keys(zip).sort();
    const pfadBeleg = `dokumente/${beleg.id}/__.._Rechnung;42.pdf`;
    expect(namen).toEqual(
      [
        "dokumente.csv",
        "index.xml",
        "mails.csv",
        "protokoll.csv",
        "pruefsummen.sha256",
        "pruefwert.txt",
        "zeitstempel.csv",
        pfadBeleg,
        `dokumente/${offen.id}/eingang.txt`,
      ].sort(),
    );
    // Das Original kommt Byte für Byte, der Name führt aus seinem Ordner nicht heraus
    expect(strFromU8(zip[pfadBeleg]!)).toBe("%PDF-1.7\n% Rechnung 42\n");

    const dokumente = strFromU8(zip["dokumente.csv"]!);
    expect(dokumente.startsWith("﻿ID;Dateiname;Typ;Größe;SHA-256;")).toBe(true);
    const zeile = dokumente.split("\r\n").find((z) => z.startsWith(beleg.id))!;
    expect(zeile).toContain(`;beleg;${jahr}-03-01;${Number(jahr) + 8}-12-31;"Rechnung ""Nr. 42""";Muster GmbH;`);
    expect(zeile).toContain(`"${pfadBeleg}"`);
    expect(dokumente).not.toContain(alt.id);
    expect(dokumente).not.toContain(geloescht.id);

    const index = strFromU8(zip["index.xml"]!);
    expect(index).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-03-2019.dtd">');
    for (const csvDatei of ["dokumente.csv", "mails.csv", "protokoll.csv"])
      expect(index).toContain(`<URL>${csvDatei}</URL>`);

    // Jede Datei außer der Liste selbst steht mit ihrem SHA-256 in pruefsummen.sha256
    const summen = strFromU8(zip["pruefsummen.sha256"]!).trim().split("\n");
    expect(summen).toHaveLength(namen.length - 1);
    for (const z of summen) {
      const [hash, name] = z.split("  ");
      expect(createHash("sha256").update(zip[name!]!).digest("hex")).toBe(hash);
    }

    const [kopf] = await t.sql`select seq, encode(hash, 'hex') as hash from audit_chain`;
    expect(strFromU8(zip["pruefwert.txt"]!)).toContain(kopf!.hash);

    // Der Löschnachweis steht im Protokoll, auch wenn das Dokument fehlt
    const protokoll = strFromU8(zip["protokoll.csv"]!);
    expect(protokoll).toContain(";loeschungen;");
    expect(protokoll.split("\r\n")[0]).toBe("﻿Nr;Zeitpunkt;Akteur;Tabelle;Zeile;Aktion;Neuer Wert;Hash Vorgänger;Hash");
  });

  it("nimmt Mails mit ihrem Kopf auf", async () => {
    const eml = [
      "From: Lieferant <rechnung@example.org>",
      "To: anna@example.org",
      "Subject: Rechnung Juni",
      "Message-ID: <juni@example.org>",
      `Date: Mon, 1 Jun ${jahr} 10:00:00 +0200`,
      "",
      "Anbei die Rechnung.",
      "",
    ].join("\r\n");
    const form = new FormData();
    form.append("datei", new File([eml], "juni.eml"));
    const { neu } = await (await als(inhaber)("/api/mails", { method: "POST", body: form })).json();
    const zip = await exportieren(inhaber, heute, heute);
    const mails = strFromU8(zip["mails.csv"]!);
    expect(mails).toContain(`${neu[0]};<juni@example.org>;;rechnung@example.org;anna@example.org;Rechnung Juni;`);
  });

  it("lässt auch die Steuerberatung exportieren und lehnt einen ungültigen Zeitraum ab", async () => {
    const zip = await exportieren(kanzlei, "2019-01-01", "2019-12-31");
    expect(Object.keys(zip)).toContain(`dokumente/${alt.id}/alt.pdf`);
    expect((await als(kanzlei)("/api/export?von=2026-02-30&bis=2026-12-31")).status).toBe(400);
    expect((await als(kanzlei)("/api/export?von=2026-12-31&bis=2026-01-01")).status).toBe(400);
    expect((await als(kanzlei)("/api/export")).status).toBe(400);
  });

  it("bricht ab, statt ein verändertes Original auszuliefern", async () => {
    const [zeile] = await t.sql`select sha256 from dokumente where id = ${alt.id}`;
    await writeFile(t.speicher.pfad(zeile!.sha256), "verändert");
    const res = await als(inhaber)("/api/export?von=2019-01-01&bis=2019-12-31");
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
