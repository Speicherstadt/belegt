import { createHash } from "node:crypto";
import { degrees, PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { rasterVerfuegbar } from "../vorschaubild/raster.ts";

async function pdf(seiten: number) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= seiten; i++) doc.addPage([100 + i, 200]);
  return new Uint8Array(await doc.save());
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!testDatenbankUrl)("Ableitungen gegen Postgres", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const als = (pfad: string, init: RequestInit = {}, c = cookie) => t.anfrage(pfad, init, c);
  const post = (pfad: string, body: unknown, c = cookie) =>
    als(pfad, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, c);
  const hoch = async (bytes: Uint8Array, name: string) => {
    const f = new FormData();
    f.append("datei", new File([new Uint8Array(bytes)], name));
    return (await (await als("/api/dokumente", { method: "POST", body: f })).json()) as { id: string; sha256: string };
  };
  const datei = async (id: string) => new Uint8Array(await (await als(`/api/dokumente/${id}/datei`)).arrayBuffer());
  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("dreht eine Seite als neues Dokument; das Original bleibt Byte für Byte", async () => {
    const bytes = await pdf(2);
    const original = await hoch(bytes, "scan.pdf");
    const res = await post(`/api/dokumente/${original.id}/seiten`, {
      operation: "drehen",
      drehungen: [{ seite: 2, grad: 90 }],
    });
    expect(res.status).toBe(201);
    const { dokumente } = (await res.json()) as { dokumente: { id: string; quelle: string; dateiname: string }[] };
    expect(dokumente).toHaveLength(1);
    const neu = dokumente[0]!;
    expect(neu).toMatchObject({ quelle: "abgeleitet", dateiname: "scan (gedreht).pdf" });
    const gedreht = await PDFDocument.load(await datei(neu.id));
    expect(gedreht.getPages().map((s) => s.getRotation().angle)).toEqual([0, 90]);
    expect(await datei(original.id)).toEqual(bytes);
    expect(sha(await datei(original.id))).toBe(original.sha256);

    const aus = (await (await als(`/api/dokumente/${neu.id}/ableitungen`)).json()) as {
      aus: { dokumentId: string; operation: string; parameter: unknown; akteur: string }[];
      daraus: unknown[];
    };
    expect(aus.aus).toMatchObject([
      {
        dokumentId: original.id,
        operation: "drehen",
        parameter: { drehungen: [{ seite: 2, grad: 90 }] },
        akteur: "nutzer:anna@example.org",
      },
    ]);
    expect(aus.daraus).toEqual([]);
    const daraus = await (await als(`/api/dokumente/${original.id}/ableitungen`)).json();
    expect(daraus.daraus.map((v: { dokumentId: string }) => v.dokumentId)).toEqual([neu.id]);
    // Im Verlauf beider Dokumente, mit Richtung
    const verlauf = async (id: string) =>
      (
        (await (await als(`/api/dokumente/${id}/verlauf`)).json()).ereignisse as {
          tabelle: string;
          richtung?: string;
        }[]
      )
        .filter((e) => e.tabelle === "ableitungen")
        .map((e) => e.richtung);
    expect(await verlauf(neu.id)).toEqual(["aus"]);
    expect(await verlauf(original.id)).toEqual(["daraus"]);
    // Das neue Dokument liegt im Eingang
    const eingang = (await (await als("/api/dokumente?gruppe=offen")).json()) as { id: string }[];
    expect(eingang.map((d) => d.id)).toContain(neu.id);
  });

  it("entfernt Seiten, teilt in zwei Dokumente und fügt in gewählter Reihenfolge zusammen", async () => {
    const a = await hoch(await pdf(3), "a.pdf");
    const b = await hoch(await pdf(1), "b.pdf");
    const ohne = await (await post(`/api/dokumente/${a.id}/seiten`, { operation: "entfernen", seiten: [2] })).json();
    expect((await PDFDocument.load(await datei(ohne.dokumente[0].id))).getPageCount()).toBe(2);

    const geteilt = await (await post(`/api/dokumente/${a.id}/seiten`, { operation: "teilen", nach: 2 })).json();
    expect(geteilt.dokumente.map((d: { dateiname: string }) => d.dateiname)).toEqual(["a-1.pdf", "a-2.pdf"]);
    const anzahl = async (id: string) => (await PDFDocument.load(await datei(id))).getPageCount();
    expect([await anzahl(geteilt.dokumente[0].id), await anzahl(geteilt.dokumente[1].id)]).toEqual([2, 1]);

    const res = await post("/api/dokumente/zusammenfuegen", { ids: [b.id, a.id] });
    expect(res.status).toBe(201);
    const zusammen = await res.json();
    const seiten = (await PDFDocument.load(await datei(zusammen.id))).getPages().map((s) => Math.round(s.getWidth()));
    expect(seiten).toEqual([101, 101, 102, 103]);
    const aus = (await (await als(`/api/dokumente/${zusammen.id}/ableitungen`)).json()).aus as {
      dokumentId: string;
      position: number;
    }[];
    expect(aus.map((v) => [v.dokumentId, v.position])).toEqual([
      [b.id, 1],
      [a.id, 2],
    ]);
  });

  it("lehnt Ungültiges ab: keine PDFs, Seiten, die es nicht gibt, kaputte PDFs, doppelte IDs", async () => {
    const text = await hoch(new TextEncoder().encode("nur Text"), "notiz.txt");
    const p = await hoch(await pdf(2), "zwei.pdf");
    const kaputt = await hoch(new TextEncoder().encode("%PDF-1.4\nkaputt"), "kaputt.pdf");
    expect((await post(`/api/dokumente/${text.id}/seiten`, { operation: "teilen", nach: 1 })).status).toBe(400);
    const zuWeit = await post(`/api/dokumente/${p.id}/seiten`, { operation: "entfernen", seiten: [5] });
    expect(zuWeit.status).toBe(400);
    expect((await zuWeit.json()).fehler).toMatch("Seite 5 gibt es nicht");
    expect((await post(`/api/dokumente/${p.id}/seiten`, { operation: "drehen", drehungen: [] })).status).toBe(400);
    expect((await post(`/api/dokumente/${kaputt.id}/seiten`, { operation: "teilen", nach: 1 })).status).toBe(422);
    expect((await post("/api/dokumente/zusammenfuegen", { ids: [p.id, p.id] })).status).toBe(400);
    expect((await post("/api/dokumente/zusammenfuegen", { ids: [p.id, text.id] })).status).toBe(400);
  });

  it("hält die Verknüpfung versiegelt: Ändern und Löschen lehnt Postgres ab, auch für andere Dokumente", async () => {
    const q = await hoch(await pdf(2), "quelle.pdf");
    const r = await (await post(`/api/dokumente/${q.id}/seiten`, { operation: "teilen", nach: 1 })).json();
    const neu = r.dokumente[0].id as string;
    await expect(t.sql`update ableitungen set operation = 'drehen' where dokument_id = ${neu}`).rejects.toThrow(
      "darf nur ergänzt werden",
    );
    await expect(t.sql`delete from ableitungen where dokument_id = ${neu}`).rejects.toThrow("darf nur ergänzt werden");
    // Nur ein abgeleitetes Dokument bekommt eine Quelle
    await expect(
      t.sql`insert into ableitungen (dokument_id, quelle_id, operation, akteur) values (${q.id}, ${neu}, 'drehen', 'x')`,
    ).rejects.toThrow("Nur ein abgeleitetes Dokument");
    expect(await t.sql`select 1 from seals where table_name = 'ableitungen'`).not.toHaveLength(0);
    const befunde = await (await als("/api/pruefung")).json();
    expect(befunde.ok).toBe(true);
  });

  it("leitet nichts aus einem gelöschten Dokument ab", async () => {
    const q = await hoch(await pdf(2), "weg.pdf");
    await post(`/api/dokumente/${q.id}/einordnung`, { art: "frei", entstanden: "2026-01-02" });
    expect((await als(`/api/dokumente/${q.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect((await post(`/api/dokumente/${q.id}/seiten`, { operation: "teilen", nach: 1 })).status).toBe(410);
  });

  it("lässt nur den Inhaber mit Sitzung bearbeiten; Prüfer sehen Ableitungen nur im Zeitraum", async () => {
    const q = await hoch(await pdf(2), "rollen.pdf");
    await post(`/api/dokumente/${q.id}/einordnung`, { art: "beleg", entstanden: "2024-04-01" });
    const steuer = await zugangAnlegen(t, cookie, "stb@example.org", { rolle: "steuerberatung" });
    expect((await post(`/api/dokumente/${q.id}/seiten`, { operation: "teilen", nach: 1 }, steuer)).status).toBe(403);
    const token = await tokenAnlegen(t, cookie, "schreiben");
    const mitToken = await t.anfrage(`/api/dokumente/${q.id}/seiten`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ operation: "teilen", nach: 1 }),
    });
    expect(mitToken.status).toBe(403);

    const r = await (await post(`/api/dokumente/${q.id}/seiten`, { operation: "teilen", nach: 1 })).json();
    const neu = r.dokumente[0].id as string;
    const pruefer = await zugangAnlegen(t, cookie, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
    // Das neue Dokument ist nicht eingeordnet und liegt mit seinem Eingang (heute) außerhalb
    const sicht = await (await t.anfrage(`/api/dokumente/${q.id}/ableitungen`, {}, pruefer)).json();
    expect(sicht.daraus).toEqual([]);
    expect((await t.anfrage(`/api/dokumente/${neu}/ableitungen`, {}, pruefer)).status).toBe(404);
    await post(`/api/dokumente/${neu}/einordnung`, { art: "beleg", entstanden: "2024-04-01" });
    const danach = await (await t.anfrage(`/api/dokumente/${q.id}/ableitungen`, {}, pruefer)).json();
    expect(danach.daraus.map((v: { dokumentId: string }) => v.dokumentId)).toEqual([neu]);
  });

  it.skipIf(!rasterVerfuegbar())("zeigt Seiten als Bilder und zählt sie", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().setRotation(degrees(90));
    doc.addPage();
    const q = await hoch(new Uint8Array(await doc.save()), "bilder.pdf");
    expect(await (await als(`/api/dokumente/${q.id}/seiten`)).json()).toEqual({ anzahl: 2 });
    const bild = await als(`/api/dokumente/${q.id}/seiten/2`);
    expect(bild.status).toBe(200);
    expect(bild.headers.get("content-type")).toBe("image/jpeg");
    expect((await als(`/api/dokumente/${q.id}/seiten/3`)).status).toBe(404);
    expect((await als(`/api/dokumente/${q.id}/seiten/abc`)).status).toBe(400);
  });
});
