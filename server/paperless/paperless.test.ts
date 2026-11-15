import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { naechsterImport } from "./ausfuehren.ts";
import { abbrechen } from "./laeufe.ts";
import { type TestPaperless, testPaperless } from "./test-paperless.ts";

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n`);
const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
const anna = { id: 3, username: "anna" };

describe.skipIf(!testDatenbankUrl)("Import aus Paperless-ngx über die API", { timeout: 60_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let steuer: string;
  let ordner: string;
  let p: TestPaperless;
  const post = (pfad: string, body?: unknown, cookie = inhaber) =>
    t.anfrage(
      pfad,
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );
  const get = async <T>(pfad: string, cookie = inhaber) => (await (await t.anfrage(pfad, {}, cookie)).json()) as T;
  const lauf = () =>
    naechsterImport({ db: t.db, speicher: t.speicher }, { schluessel: t.schluessel, importOrdner: ordner });
  type Lauf = {
    id: string;
    status: string;
    gesamt: number;
    uebernommen: number;
    doppelt: number;
    fehler: number;
    hinweise: string[];
    meldung: string | null;
  };
  const quelleAnlegen = async (ziel: TestPaperless, token = ziel.token) => {
    const res = await post("/api/paperless/quellen", { name: "Alt", url: `${ziel.url}/`, token });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  };

  beforeAll(async () => {
    ordner = await mkdtemp(join(tmpdir(), "belegt-import-"));
    t = await testApp({ importOrdner: ordner });
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    steuer = await zugangAnlegen(t, inhaber, "stb@example.org", { rolle: "steuerberatung" });
    const md5Original = pdf("Steuerbescheid");
    p = await testPaperless({
      seitenGroesse: 2,
      tags: [
        { id: 1, name: "Strom" },
        { id: 2, name: "Steuer 2026" },
        { id: 3, name: "Archiv" },
      ],
      correspondents: [{ id: 1, name: "Stadtwerke" }],
      document_types: [
        { id: 1, name: "Rechnung" },
        { id: 2, name: "Vertrag" },
      ],
      custom_fields: [
        { id: 1, name: "Summe", data_type: "monetary", extra_data: { default_currency: "EUR" } },
        { id: 2, name: "Kundennummer", data_type: "integer", extra_data: {} },
        {
          id: 3,
          name: "Status",
          data_type: "select",
          extra_data: {
            select_options: [
              { id: "s1", label: "Offen" },
              { id: "s2", label: "Bezahlt" },
            ],
          },
        },
        { id: 4, name: "Bemerkung", data_type: "string", extra_data: {} },
        { id: 5, name: "Faktor", data_type: "float", extra_data: {} },
        { id: 6, name: "Fällig", data_type: "date", extra_data: {} },
        { id: 7, name: "Erledigt", data_type: "boolean", extra_data: {} },
        { id: 8, name: "Portal", data_type: "url", extra_data: {} },
        { id: 9, name: "Zukunft", data_type: "hologramm", extra_data: {} },
      ],
      dokumente: [
        {
          id: 1,
          title: "Strom Januar",
          correspondent: 1,
          document_type: 1,
          tags: [1],
          created: "2026-02-01",
          archive_serial_number: 101,
          original_file_name: "strom-januar.pdf",
          notes: [{ id: 1, note: "Bezahlt per Lastschrift", created: "2026-02-03T09:00:00Z", user: anna }],
          custom_fields: [
            { field: 1, value: "EUR89.90" },
            { field: 2, value: 4711 },
            { field: 3, value: "s2" },
            { field: 4, value: "Abschlag" },
            { field: 5, value: 1.5 },
            { field: 6, value: "2026-02-15" },
            { field: 7, value: true },
            { field: 8, value: "https://stadtwerke.example/konto" },
            { field: 9, value: "unbekannt" },
          ],
          original: pdf("Strom Januar"),
        },
        {
          id: 2,
          title: "Mietvertrag",
          document_type: 2,
          tags: [3],
          original_file_name: "miete.pdf",
          original: pdf("Mietvertrag"),
          checksum: md5(pdf("etwas anderes")),
        },
        {
          id: 3,
          title: "Steuerbescheid",
          tags: [2],
          created: "2025-11-30",
          original_file_name: "bescheid.pdf",
          custom_fields: [{ field: 1, value: "USD5.00" }],
          original: md5Original,
          // Ältere Versionen von Paperless-ngx nennen den MD5
          checksum: md5(md5Original),
        },
      ],
    });
  });
  afterAll(async () => {
    await p?.beenden();
    await t?.aufraeumen();
    await rm(ordner, { recursive: true, force: true });
  });

  it("speichert das Token nur verschlüsselt und gibt es nie heraus", async () => {
    const q = await quelleAnlegen(p);
    expect(q).not.toHaveProperty("ciphertext");
    expect(JSON.stringify(q)).not.toContain(p.token);
    expect(JSON.stringify(await get("/api/paperless/quellen"))).not.toContain(p.token);
    const [zeile] = await t.sql<{ url: string; ciphertext: Buffer }[]>`select url, ciphertext from paperless_quellen`;
    expect(zeile!.url).toBe(p.url);
    expect(Buffer.from(zeile!.ciphertext).toString("latin1")).not.toContain(p.token);
    const audit = await t.sql<
      { v: string }[]
    >`select new_value::text as v from audit_log where table_name = 'paperless_quellen'`;
    expect(audit.length).toBe(1);
    expect(audit[0]!.v).not.toContain(p.token);
    expect(audit[0]!.v).not.toContain("ciphertext");
  });

  it("lässt nur den Inhaber mit Sitzung an den Umzug", async () => {
    expect((await t.anfrage("/api/paperless/importe", {}, steuer)).status).toBe(403);
    expect((await t.anfrage("/api/paperless/quellen", {}, steuer)).status).toBe(403);
    expect((await post("/api/paperless/quellen", { name: "x", url: p.url, token: "x" }, steuer)).status).toBe(403);
    const token = await tokenAnlegen(t, inhaber, "schreiben");
    const mitToken = await t.anfrage("/api/paperless/importe", { headers: { authorization: `Bearer ${token}` } });
    expect(mitToken.status).toBe(403);
    expect((await post("/api/paperless/quellen", { name: "x", url: "ftp://x", token: "x" })).status).toBe(400);
  });

  it("importiert seitenweise mit Tags, Typen, Feldern, Notizen und Zuordnung zur Art", async () => {
    expect(
      (await post("/api/paperless/zuordnungen", { art: "dokumenttyp", name: "rechnung", zielArt: "beleg" })).status,
    ).toBe(201);
    expect(
      (await post("/api/paperless/zuordnungen", { art: "dokumenttyp", name: "Rechnung", zielArt: "frei" })).status,
    ).toBe(409);
    const [q] = await get<{ id: string }[]>("/api/paperless/quellen");
    const start = await post(`/api/paperless/quellen/${q!.id}/starten`);
    expect(start.status).toBe(201);
    expect((await post(`/api/paperless/quellen/${q!.id}/starten`)).status).toBe(409);
    expect(await lauf()).toMatchObject({ status: "fertig" });

    const [l] = await get<Lauf[]>("/api/paperless/importe");
    expect(l).toMatchObject({ status: "fertig", gesamt: 3, uebernommen: 2, doppelt: 0, fehler: 1 });
    expect(l!.hinweise).toEqual(
      expect.arrayContaining([
        expect.stringContaining("„Faktor“ (Kommazahl)"),
        expect.stringContaining("„Zukunft“ hat einen unbekannten Typ"),
      ]),
    );
    expect(await get(`/api/paperless/importe/${l!.id}/fehler`)).toEqual([
      { paperlessId: 2, titel: "Mietvertrag", grund: "Prüfsumme passt nicht zum geladenen Original" },
    ]);

    // Nur die eingetragene Adresse, immer mit Token und Version, Originale immer mit original=true
    expect(p.anfragen.every((a) => a.authorization === `Token ${p.token}`)).toBe(true);
    expect(p.anfragen.every((a) => a.accept === "application/json; version=9")).toBe(true);
    const downloads = p.anfragen.filter((a) => a.pfad.includes("/download/"));
    expect(downloads.length).toBe(3);
    expect(downloads.every((a) => a.pfad.endsWith("?original=true"))).toBe(true);
    // Geblättert: zwei Seiten zu je zwei Dokumenten (der Server kürzt page_size)
    expect(
      p.anfragen.filter((a) => a.pfad.startsWith("/api/documents/?page=") && a.pfad.includes("ordering=id")).length,
    ).toBe(2);

    const docs = await t.sql<{ id: string; dateiname: string; quelle: string; sha256: string }[]>`
      select id, dateiname, quelle, sha256 from dokumente order by dateiname`;
    expect(docs.map((d) => [d.dateiname, d.quelle])).toEqual([
      ["bescheid.pdf", "import"],
      ["strom-januar.pdf", "import"],
    ]);
    const strom = docs.find((d) => d.dateiname === "strom-januar.pdf")!;
    const bescheid = docs.find((d) => d.dateiname === "bescheid.pdf")!;
    expect(strom.sha256).toBe(createHash("sha256").update(pdf("Strom Januar")).digest("hex"));

    const d = await get<{
      tags: { name: string }[];
      dokumenttyp: { name: string };
      felder: { name: string; typ: string; wert: unknown }[];
      einordnung: { art: string; entstanden: string; titel: string; korrespondent: string } | null;
      korrespondent: { name: string } | null;
    }>(`/api/dokumente/${strom.id}`);
    expect(d.tags.map((x) => x.name)).toEqual(["Strom"]);
    // Der Korrespondent aus Paperless-ngx steht in der Liste und ist dem Dokument zugeordnet
    expect(d.korrespondent?.name).toBe("Stadtwerke");
    expect(
      (await get<{ name: string; anzahl: number }[]>("/api/korrespondenten")).map((k) => [k.name, k.anzahl]),
    ).toEqual([["Stadtwerke", 1]]);
    expect(d.dokumenttyp.name).toBe("Rechnung");
    expect(Object.fromEntries(d.felder.map((f) => [f.name, [f.typ, f.wert]]))).toEqual({
      Summe: ["betrag", 8990],
      Kundennummer: ["zahl", 4711],
      Status: ["auswahl", "Bezahlt"],
      Bemerkung: ["text", "Abschlag"],
      Faktor: ["text", "1.5"],
      Fällig: ["datum", "2026-02-15"],
      Erledigt: ["ja_nein", true],
      Portal: ["link", "https://stadtwerke.example/konto"],
      Zukunft: ["text", "unbekannt"],
      "Paperless-ASN": ["zahl", 101],
    });
    // Zuordnung Rechnung → Buchungsbeleg: gleich eingeordnet, mit Entstehung, Titel und Korrespondent aus Paperless-ngx
    expect(d.einordnung).toMatchObject({
      art: "beleg",
      entstanden: "2026-02-01",
      titel: "Strom Januar",
      korrespondent: "Stadtwerke",
    });
    const notizen = await get<{ text: string; erstelltVon: string }[]>(`/api/dokumente/${strom.id}/notizen`);
    expect(notizen).toEqual([
      expect.objectContaining({
        text: "Bezahlt per Lastschrift\n\n(Paperless-ngx: anna, 2026-02-03T09:00:00Z)",
        erstelltVon: "import:paperless",
      }),
    ]);

    // Ohne Zuordnung im Eingang, mit Vorschlag; der Betrag in Dollar steht in einer Notiz
    const b = await get<{ einordnung: unknown; tags: { name: string }[] }>(`/api/dokumente/${bescheid.id}`);
    expect(b.einordnung).toBeNull();
    expect(b.tags.map((x) => x.name)).toEqual(["Steuer 2026"]);
    expect(await get(`/api/dokumente/${bescheid.id}/vorschlag`)).toMatchObject({
      import: { titel: "Steuerbescheid", korrespondent: null, entstanden: "2025-11-30", herkunft: "Paperless-ngx" },
    });
    expect((await get<{ text: string }[]>(`/api/dokumente/${bescheid.id}/notizen`))[0]!.text).toBe(
      "Aus Paperless-ngx, ohne passendes Feld:\nSumme: USD5.00 (andere Währung als Euro: USD5.00)",
    );
    const offen = await get<{ id: string }[]>("/api/dokumente?gruppe=offen");
    expect(offen.map((x) => x.id)).toEqual([bescheid.id]);

    // Akteur im Audit-Log: import:paperless für Dokument, Tags, Felder, Notizen und Einordnung
    const akteure = await t.sql<{ table_name: string; actor: string }[]>`
      select distinct table_name, actor from audit_log
       where table_name in ('dokumente', 'dokument_tags', 'feldwerte', 'notizen', 'einordnungen', 'import_eintraege', 'felder',
                            'tags', 'korrespondenten', 'dokument_korrespondenten')`;
    expect(new Set(akteure.map((a) => a.actor))).toEqual(new Set(["import:paperless"]));
    expect(new Set(akteure.map((a) => a.table_name)).size).toBe(10);
    // Die Verfahrensdokumentation führt den Import mit Zahlen und Prüfsummenabgleich auf
    const doku = JSON.stringify(await get("/api/verfahrensdoku"));
    expect(doku).toContain("Import aus Paperless-ngx (API „Alt“) vom ");
    expect(doku).toContain("2 von 3 übernommen, davon 0 schon im Archiv, 1 nicht übernommen (Prüfsumme abgeglichen)");
    expect(doku).toContain("vergleicht Belegt die Prüfsumme aus Paperless-ngx");
    // Das Ergebnis je Dokument ist versiegelt
    await expect(t.sql`update import_eintraege set grund = 'x'`).rejects.toThrow();
  });

  it("macht nach einem Abbruch mit einem neuen Lauf dort weiter und verknüpft doppelte Originale", async () => {
    const vorhanden = pdf("Doppelt");
    const f = new FormData();
    f.append("datei", new File([vorhanden], "schon-da.pdf"));
    const schon = (await (await t.anfrage("/api/dokumente", { method: "POST", body: f }, inhaber)).json()) as {
      id: string;
    };
    const p2 = await testPaperless({
      notizenEinzeln: true,
      dokumente: [1, 2, 3, 4].map((id) => ({
        id,
        title: `Brief ${id}`,
        original_file_name: `brief-${id}.pdf`,
        notes:
          id === 4 ? [{ id: 9, note: "Notiz über die eigene Route", created: "2026-01-01T00:00:00Z", user: anna }] : [],
        original: id === 3 ? vorhanden : pdf(`Brief ${id}`),
      })),
    });
    try {
      const q = await quelleAnlegen(p2);
      const erster = (await (await post(`/api/paperless/quellen/${q.id}/starten`)).json()) as { id: string };
      p2.beimDownload = async (id) => {
        if (id === 2) await abbrechen(t.db, erster.id, "nutzer:anna@example.org");
      };
      expect(await lauf()).toMatchObject({ id: erster.id, status: "abgebrochen" });
      let [l] = await get<Lauf[]>("/api/paperless/importe");
      expect(l).toMatchObject({ id: erster.id, status: "abgebrochen", uebernommen: 2, gesamt: 4 });

      p2.beimDownload = undefined;
      const zweiter = (await (await post(`/api/paperless/quellen/${q.id}/starten`)).json()) as { id: string };
      expect(await lauf()).toMatchObject({ id: zweiter.id, status: "fertig" });
      [l] = await get<Lauf[]>("/api/paperless/importe");
      // 2 aus dem ersten Lauf, 2 aus diesem, davon eines schon im Archiv
      expect(l).toMatchObject({ id: zweiter.id, status: "fertig", uebernommen: 4, doppelt: 1, fehler: 0, gesamt: 4 });
      const downloads = p2.anfragen.filter((a) => a.pfad.includes("/download/")).map((a) => a.pfad.split("/")[3]);
      expect(downloads).toEqual(["1", "2", "3", "4"]);
      const eintrag = await t.sql<{ ergebnis: string; dokument_id: string }[]>`
        select ergebnis, dokument_id from import_eintraege where import_id = ${zweiter.id} and paperless_id = 3`;
      expect(eintrag[0]).toEqual({ ergebnis: "doppelt", dokument_id: schon.id });
      const sha = createHash("sha256").update(vorhanden).digest("hex");
      expect((await t.sql`select id from dokumente where sha256 = ${sha}`).length).toBe(1);
      const brief4 = await t.sql<{ id: string }[]>`select id from dokumente where dateiname = 'brief-4.pdf'`;
      expect((await get<{ text: string }[]>(`/api/dokumente/${brief4[0]!.id}/notizen`))[0]!.text).toContain(
        "Notiz über die eigene Route",
      );
    } finally {
      await p2.beenden();
    }
  });

  it("setzt einen Lauf fort, der nach einem Neustart des Workers noch läuft", async () => {
    const p3 = await testPaperless({ dokumente: [{ id: 1, title: "Neustart", original: pdf("Neustart") }] });
    try {
      const q = await quelleAnlegen(p3);
      const l = (await (await post(`/api/paperless/quellen/${q.id}/starten`)).json()) as { id: string };
      await t.sql`update importe set status = 'laeuft', begonnen_am = now() where id = ${l.id}`;
      expect(await lauf()).toMatchObject({ id: l.id, status: "fertig" });
    } finally {
      await p3.beenden();
    }
  });

  it("hält fest, wenn Postgres ein Dokument ablehnt, und macht mit dem nächsten weiter", async () => {
    const p5 = await testPaperless({
      tags: [{ id: 1, name: "   " }],
      dokumente: [
        { id: 1, title: "Leerer Tag", tags: [1], original: pdf("Leerer Tag") },
        { id: 2, title: "Danach", original: pdf("Danach") },
      ],
    });
    try {
      const q = await quelleAnlegen(p5);
      const l = (await (await post(`/api/paperless/quellen/${q.id}/starten`)).json()) as { id: string };
      expect(await lauf()).toMatchObject({ id: l.id, status: "fertig" });
      const fehler = await get<{ paperlessId: number; grund: string }[]>(`/api/paperless/importe/${l.id}/fehler`);
      expect(fehler.map((f) => f.paperlessId)).toEqual([1]);
      expect(fehler[0]!.grund).toMatch(/^Nicht aufgenommen: /);
      const sha = createHash("sha256").update(pdf("Leerer Tag")).digest("hex");
      expect(await t.sql`select id from dokumente where sha256 = ${sha}`).toHaveLength(0);
      expect(
        await t.sql`select id from dokumente where dateiname is null and sha256 = ${createHash("sha256").update(pdf("Danach")).digest("hex")}`,
      ).toHaveLength(1);
    } finally {
      await p5.beenden();
    }
  });

  it("lehnt eine Weiterleitung auf einen anderen Host und ein falsches Token ab", async () => {
    const fremd = await testPaperless({ token: "egal" });
    const p4 = await testPaperless({ dokumente: [{ id: 1, title: "x", original: pdf("x") }] });
    try {
      p4.umleiten.set("/api/tags/", `${fremd.url}/api/tags/`);
      const q = await quelleAnlegen(p4);
      await post(`/api/paperless/quellen/${q.id}/starten`);
      const r = await lauf();
      expect(r).toMatchObject({ status: "fehler" });
      expect(r!.meldung).toContain("Weiterleitung auf einen anderen Host abgelehnt");
      // Das Token ging nicht an den anderen Host
      expect(fremd.anfragen).toEqual([]);

      p4.umleiten.clear();
      const falsch = await quelleAnlegen(p4, "falsches-token");
      await post(`/api/paperless/quellen/${falsch.id}/starten`);
      const r2 = await lauf();
      expect(r2).toMatchObject({ status: "fehler" });
      expect(r2!.meldung).toContain("lehnt das Token ab (401)");
      expect(r2!.meldung).not.toContain("falsches-token");
    } finally {
      await fremd.beenden();
      await p4.beenden();
    }
    expect(await readdir(ordner)).toEqual([]);
  });
});
