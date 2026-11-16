import { rm } from "node:fs/promises";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { auswahlZip, eindeutig, nameImZip, namensteil } from "./auswahl.ts";

describe("Namen im ZIP", () => {
  const basis = { asn: 42, tag: "2026-03-14", titel: null, dateiname: null, mimeType: "application/pdf" };

  it("setzt Archivnummer, Tag, Titel und die Endung des Originals zusammen", () => {
    expect(nameImZip({ ...basis, titel: "Rechnung Telekom", dateiname: "scan_001.PDF" })).toBe(
      "ASN0042-2026-03-14-Rechnung Telekom.pdf",
    );
  });

  it("nimmt ohne Titel den Dateinamen und ohne Endung die zum Typ", () => {
    expect(nameImZip({ ...basis, dateiname: "brief" })).toBe("ASN0042-2026-03-14-brief.pdf");
    expect(nameImZip({ ...basis, asn: 123456, mimeType: "image/jpeg" })).toBe("ASN123456-2026-03-14.jpg");
    expect(nameImZip({ ...basis, mimeType: "application/x-unbekannt" })).toBe("ASN0042-2026-03-14");
  });

  it("lässt keine Pfadzeichen, Steuerzeichen oder Punkte am Rand stehen", () => {
    expect(namensteil("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(namensteil(' a:b*c?"d<e>f|g\\h\u0000 ')).toBe("a_b_c__d_e_f_g_h_");
    expect(namensteil("..")).toBe("");
    expect(nameImZip({ ...basis, titel: "../geheim", dateiname: "x.pdf" })).toBe("ASN0042-2026-03-14-_geheim.pdf");
    expect(namensteil("x".repeat(300))).toHaveLength(100);
  });

  it("lässt keine Zeichen für die Schreibrichtung und kein halbes Zeichen stehen", () => {
    // Ein Anhang „Rechnung\u202Efdp.exe“ zeigte sich sonst als „Rechnungexe.pdf“
    expect(nameImZip({ ...basis, dateiname: "Rechnung\u202Efdp.exe" })).toBe("ASN0042-2026-03-14-Rechnung_fdp.exe");
    expect(namensteil("a\u200Bb\u200Fc\u2066d\u2069e\uFEFFf")).toBe("a_b_c_d_e_f");
    expect(namensteil(`${"x".repeat(99)}\u{1F600}y`)).toBe(`${"x".repeat(99)}\u{1F600}`);
  });

  it("nummeriert gleiche Namen ohne Rücksicht auf Groß- und Kleinschreibung", () => {
    expect(eindeutig(["a.pdf", "A.pdf", "a.pdf", "b", "b"])).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "b", "b (2)"]);
  });
});

describe.skipIf(!testDatenbankUrl)("ZIP-Download gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let leser: string;
  let drin: { id: string; sha256: string };
  let draussen: { id: string; sha256: string };
  let ohneDatei: { id: string; sha256: string };
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function hochladen(inhalt: string, name: string) {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], name));
    return (await (await t.anfrage("/api/dokumente", { method: "POST", body: form }, inhaber)).json()) as {
      id: string;
      sha256: string;
      asn: number;
    };
  }

  const laden = (cookie: string, ids: string[]) => t.anfrage(`/api/dokumente/zip?ids=${ids.join(",")}`, {}, cookie);
  const entpacken = async (res: Response) => unzipSync(new Uint8Array(await res.arrayBuffer()));

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const tag = (await (await t.anfrage("/api/tags", json({ name: "Projekt" }), inhaber)).json()) as { id: string };
    drin = await hochladen("%PDF-1.7\n% drin\n", "drin.pdf");
    await t.anfrage(`/api/dokumente/${drin.id}/ordnung`, json({ tagsHinzu: [tag.id] }), inhaber);
    await t.anfrage(
      `/api/dokumente/${drin.id}/einordnung`,
      json({ art: "beleg", entstanden: "2026-03-14", titel: "Rechnung: März/April" }),
      inhaber,
    );
    draussen = await hochladen("%PDF-1.7\n% draussen\n", "draussen.pdf");
    ohneDatei = await hochladen("nur Text, gleich weg\n", "weg.txt");
    await rm(t.speicher.pfad(ohneDatei.sha256));
    leser = await zugangAnlegen(t, inhaber, "leser@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [tag.id] },
    });
  });
  afterAll(() => t?.aufraeumen());

  it("liefert die Originale unverändert unter lesbaren Namen in der gewählten Reihenfolge", async () => {
    const res = await laden(inhaber, [draussen.id, drin.id]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="belegt-\d{4}-\d{2}-\d{2}\.zip"$/);
    const zip = await entpacken(res);
    const namen = Object.keys(zip);
    expect(namen).toHaveLength(2);
    expect(namen[0]).toMatch(/^ASN\d{4}-\d{4}-\d{2}-\d{2}-draussen\.pdf$/);
    expect(namen[1]).toMatch(/^ASN\d{4}-2026-03-14-Rechnung_ März_April\.pdf$/);
    expect(new TextDecoder().decode(zip[namen[1]!])).toBe("%PDF-1.7\n% drin\n");
  });

  it("hält die gewählte Reihenfolge auch für IDs in Großbuchstaben und nimmt jedes Dokument einmal", async () => {
    for (const [erstes, zweites, name] of [
      [drin, draussen, /Rechnung/],
      [draussen, drin, /draussen/],
    ] as const) {
      const ids = [erstes.id.toUpperCase(), zweites.id.toUpperCase(), erstes.id];
      const namen = Object.keys(await entpacken(await laden(inhaber, ids)));
      expect(namen).toHaveLength(2);
      expect(namen[0]).toMatch(name);
    }
  });

  it("nennt ein fehlendes Original in nicht-enthalten.txt, statt es still wegzulassen", async () => {
    const zip = await entpacken(await laden(inhaber, [drin.id, ohneDatei.id]));
    expect(Object.keys(zip)).toHaveLength(2);
    expect(new TextDecoder().decode(zip["nicht-enthalten.txt"])).toMatch(
      /^ASN\d{4}-\d{4}-\d{2}-\d{2}-weg\.txt: Datei fehlt oder wurde verändert\n$/,
    );
  });

  it("gibt Mitarbeitern nur, was in ihrem Sichtbereich liegt, ohne das andere zu erwähnen", async () => {
    const zip = await entpacken(await laden(leser, [drin.id, draussen.id]));
    expect(Object.keys(zip)).toEqual([expect.stringMatching(/Rechnung/)]);
    expect((await laden(leser, [draussen.id])).status).toBe(404);
  });

  it("gibt dem Prüfer nur Dokumente seines Zeitraums", async () => {
    const pruefer = await zugangAnlegen(t, inhaber, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2026-03-01", bis: "2026-03-31" },
    });
    const zip = await entpacken(await laden(pruefer, [drin.id, draussen.id]));
    expect(Object.keys(zip)).toEqual([expect.stringMatching(/Rechnung/)]);
  });

  it("lehnt ungültige IDs und zu viele Dokumente ab", async () => {
    expect((await laden(inhaber, [])).status).toBe(400);
    expect((await laden(inhaber, ["kein-uuid"])).status).toBe(400);
    expect(
      (
        await laden(
          inhaber,
          Array.from({ length: 201 }, () => crypto.randomUUID()),
        )
      ).status,
    ).toBe(400);
  });

  it("lehnt eine Auswahl über der Größengrenze ab, bevor etwas gelesen wird", async () => {
    const umgebung = { db: t.db, speicher: t.speicher };
    expect(await auswahlZip(umgebung, [drin.id, draussen.id], undefined, { maxBytes: 20 })).toEqual({
      ok: false,
      grund: "zu_gross",
    });
    expect((await auswahlZip(umgebung, [drin.id], undefined, { maxBytes: 20 })).ok).toBe(true);
  });
});
