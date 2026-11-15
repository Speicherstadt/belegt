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
    const tag = async (name: string) => (await (await als(inhaber)("/api/tags", json({ name }))).json()).id;
    const typ = (await (await als(inhaber)("/api/dokumenttypen", json({ name: "Eingangsrechnung" }))).json()).id;
    const summe = (await (await als(inhaber)("/api/felder", json({ name: "Summe", typ: "betrag" }))).json()).id;
    const faellig = (await (await als(inhaber)("/api/felder", json({ name: "Fällig", typ: "datum" }))).json()).id;
    await als(inhaber)(
      `/api/dokumente/${beleg.id}/ordnung`,
      json({
        tagsHinzu: [await tag("Steuer; 2026"), await tag("Auto")],
        dokumenttyp: typ,
        felder: [
          { feldId: summe, wert: "1.234,56" },
          { feldId: faellig, wert: `${jahr}-04-01` },
        ],
      }),
    );
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
        "felder.csv",
        "index.xml",
        "mails.csv",
        "protokoll.csv",
        "tags.csv",
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
    // ASN, Dokumenttyp, Tags und der Korrespondent der Liste hinten angehängt; ein Tag mit Semikolon steht in
    // Anführungszeichen
    const [{ nummer }] = (await t.sql`select nummer from archivnummern where dokument_id = ${beleg.id}`) as unknown as [
      { nummer: string },
    ];
    expect(zeile.endsWith(`;${nummer};Eingangsrechnung;"Auto, Steuer; 2026";Muster GmbH`)).toBe(true);
    expect(dokumente.split("\r\n")[0]!.endsWith(";Pfad;ASN;Dokumenttyp;Tags;Korrespondent (Liste)")).toBe(true);

    const tags = strFromU8(zip["tags.csv"]!).split("\r\n");
    expect(tags[0]).toBe("\uFEFFDokument-ID;ASN;Tag");
    expect(tags).toContain(`${beleg.id};${nummer};Auto`);
    expect(tags).toContain(`${beleg.id};${nummer};"Steuer; 2026"`);
    const felder = strFromU8(zip["felder.csv"]!).split("\r\n");
    expect(felder[0]).toBe("\uFEFFDokument-ID;ASN;Feld;Feldtyp;Text;Zahl;Betrag EUR;Datum;Ja/Nein");
    expect(felder).toContain(`${beleg.id};${nummer};Summe;betrag;;;1234,56;;`);
    expect(felder).toContain(`${beleg.id};${nummer};Fällig;datum;;;;${jahr}-04-01;`);
    expect(dokumente).not.toContain(alt.id);
    expect(dokumente).not.toContain(geloescht.id);

    const index = strFromU8(zip["index.xml"]!);
    expect(index).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-03-2019.dtd">');
    for (const csvDatei of ["dokumente.csv", "mails.csv", "tags.csv", "felder.csv", "protokoll.csv"])
      expect(index).toContain(`<URL>${csvDatei}</URL>`);
    // Der Betrag ist eine Zahl mit zwei Nachkommastellen, das Datum ein Datum, die ASN ganzzahlig
    expect(index).toMatch(/<Name>Betrag EUR<\/Name>\s*<Numeric><Accuracy>2<\/Accuracy><\/Numeric>/);
    expect(index).toMatch(/<Name>Datum<\/Name>\s*<Date><Format>YYYY-MM-DD<\/Format><\/Date>/);
    expect(index).toMatch(/<Name>ASN<\/Name>\s*<Numeric><Accuracy>0<\/Accuracy><\/Numeric>/);
    // Jede Tabelle in der index.xml hat so viele Spalten wie ihre Kopfzeile
    for (const csvDatei of ["dokumente.csv", "tags.csv", "felder.csv"]) {
      const tabelle = index.split("<Table>").find((x) => x.includes(`<URL>${csvDatei}</URL>`))!;
      const spalten = (tabelle.match(/<VariableColumn>/g) ?? []).length;
      expect(spalten, csvDatei).toBe(strFromU8(zip[csvDatei]!).split("\r\n")[0]!.split(";").length);
    }
    // Zuordnungen stehen im Protokoll
    expect(strFromU8(zip["protokoll.csv"]!)).toContain(";dokument_tags;");

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

  it("Korrespondent: der versiegelte Text der Einordnung und der heutige Name der Liste nebeneinander", async () => {
    const [k] = (await (await als(inhaber)("/api/korrespondenten")).json()) as { id: string; name: string }[];
    expect(k!.name).toBe("Muster GmbH");
    expect(
      (await als(inhaber)(`/api/korrespondenten/${k!.id}`, { ...json({ name: "Muster AG" }), method: "PATCH" })).status,
    ).toBe(200);
    const zip = await exportieren(inhaber, `${jahr}-01-01`, `${jahr}-12-31`);
    const zeile = strFromU8(zip["dokumente.csv"]!)
      .split("\r\n")
      .find((z) => z.startsWith(beleg.id))!;
    expect(zeile).toContain(`;"Rechnung ""Nr. 42""";Muster GmbH;`);
    expect(zeile.endsWith(";Muster AG")).toBe(true);
    const protokoll = strFromU8(zip["protokoll.csv"]!);
    expect(protokoll).toContain(";korrespondenten;");
    expect(protokoll).toContain(";dokument_korrespondenten;");
  });

  it("gibt dem Prüfer im Protokoll die Zuordnungen seiner Dokumente, nicht die Verwaltung der Tags", async () => {
    const { pfad } = await (
      await als(inhaber)(
        "/api/einladungen",
        json({ rolle: "pruefer", zeitraum: { von: `${jahr}-01-01`, bis: `${jahr}-12-31` } }),
      )
    ).json();
    const pruefer = (
      await t.registrieren("pruefer@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    const zip = await exportieren(pruefer, `${jahr}-01-01`, `${jahr}-12-31`);
    const zeilen = strFromU8(zip["protokoll.csv"]!).split("\r\n");
    const tabellen = new Set(zeilen.slice(1).map((z) => z.split(";")[3]));
    expect(tabellen).toContain("dokument_tags");
    expect(tabellen).toContain("feldwerte");
    expect(tabellen).toContain("dokument_dokumenttypen");
    // Zuordnung und Umbenennung des Korrespondenten seiner Dokumente gehören zu deren Nachweis
    expect(tabellen).toContain("dokument_korrespondenten");
    expect(tabellen).toContain("korrespondenten");
    expect(tabellen).not.toContain("tags");
    expect(tabellen).not.toContain("felder");
    expect(strFromU8(zip["tags.csv"]!)).toContain("Auto");
    // Die Archivnummer gehört zum Dokument wie seine Einordnung: Eintrag und Siegel stehen im Protokoll
    const [asn] = await t.sql<{ id: string }[]>`select id::text from archivnummern where dokument_id = ${beleg.id}`;
    const zuAsn = zeilen.filter((z) => z.includes(asn!.id));
    expect(zuAsn.map((z) => z.split(";")[3]).sort()).toEqual(["archivnummern", "seals"]);
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
