import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

interface Nachweis {
  dokument: { id: string; dateiname: string; sha256: string; asn: number; eingegangenAm: string };
  eingangSeq: number;
  siegel: string | null;
  ereignisse: { aktion: string; tabelle: string }[];
  zeitstempel: { dienst: string; zeit: string; seq: number } | null;
  pruefung: { ok: boolean; geprueftAm: string } | null;
}

describe.skipIf(!testDatenbankUrl)("Nachweis eines Dokuments gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  let id: string;
  const anfrage = (pfad: string) => t.anfrage(pfad, {}, cookie);

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    const f = new FormData();
    f.append("datei", new File(["Rechnung 42"], "rechnung.txt"));
    id = ((await (await t.anfrage("/api/dokumente", { method: "POST", body: f }, cookie)).json()) as { id: string }).id;
  });
  afterAll(() => t?.aufraeumen());

  it("nennt Hash, Archivnummer, Eingang, Siegel und den Verlauf; ohne Zeitstempel und Prüfung bleiben die leer", async () => {
    const res = await anfrage(`/api/dokumente/${id}/nachweis`);
    expect(res.status).toBe(200);
    const n = (await res.json()) as Nachweis;
    expect(n.dokument).toMatchObject({ id, dateiname: "rechnung.txt", asn: 1 });
    expect(n.dokument.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(n.siegel).toMatch(/^[0-9a-f]{64}$/);
    expect(n.eingangSeq).toBeGreaterThan(0);
    expect(n.ereignisse.map((e) => e.tabelle)).toContain("dokumente");
    expect(n.zeitstempel).toBeNull();
    expect(n.pruefung).toBeNull();
  });

  it("nimmt den ersten Zeitstempel nach dem Eingang und die letzte Prüfung der Kette", async () => {
    const { eingangSeq } = (await (await anfrage(`/api/dokumente/${id}/nachweis`)).json()) as Nachweis;
    await t.sql`insert into zeitstempel (seq, hash, dienst, zeit, seriennummer, token)
                values (${eingangSeq - 1}, ${"a".repeat(64)}, 'Vorher-TSA', now() - interval '1 day', '1', '\\x00'),
                       (${eingangSeq + 5}, ${"b".repeat(64)}, 'Danach-TSA', now(), '2', '\\x00')`;
    await t.sql`insert into kettenpruefungen (ok, befunde, eintraege, dauer_ms, ausgeloest_von)
                values (true, 0, 10, 5, 'worker')`;
    const n = (await (await anfrage(`/api/dokumente/${id}/nachweis`)).json()) as Nachweis;
    expect(n.zeitstempel).toMatchObject({ dienst: "Danach-TSA", seq: eingangSeq + 5 });
    expect(n.pruefung).toMatchObject({ ok: true });
  });

  it("liefert ein PDF mit dem Hash in den Metadaten; unbekannte Dokumente gibt es nicht", async () => {
    const res = await anfrage(`/api/dokumente/${id}/nachweis.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const pdf = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    const { dokument } = (await (await anfrage(`/api/dokumente/${id}/nachweis`)).json()) as Nachweis;
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getKeywords()).toContain(dokument.sha256);
    expect((await anfrage("/api/dokumente/00000000-0000-4000-8000-000000000000/nachweis")).status).toBe(404);
  });
});
