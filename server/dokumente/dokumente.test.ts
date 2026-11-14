import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { testDatenbank, testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Dokumente gegen Postgres", () => {
  let sql: postgres.Sql;
  let verzeichnis: string;
  let app: ReturnType<typeof createApp>;
  let speicher: ReturnType<typeof dateispeicher>;

  beforeAll(async () => {
    sql = await testDatenbank();
    verzeichnis = await mkdtemp(join(tmpdir(), "belegt-dokumente-"));
    speicher = dateispeicher({ verzeichnis: () => verzeichnis });
    app = createApp({ db: drizzle(sql), speicher });
  });

  afterAll(async () => {
    await sql?.end();
    await rm(verzeichnis, { recursive: true, force: true });
  });

  const pdf = new TextEncoder().encode("%PDF-1.7\n% erfundene Rechnung über 119,00 €\n");

  async function hochladen(bytes: Uint8Array, name: string) {
    const form = new FormData();
    form.append("datei", new File([new Uint8Array(bytes)], name));
    return app.request("/api/dokumente", { method: "POST", body: form });
  }

  it("nimmt ein Original unverändert auf, mit Hash, Typ am Inhalt und Eintrag im Audit-Log", async () => {
    const res = await hochladen(pdf, "Rechnung-2026-11.pdf");
    expect(res.status).toBe(201);
    const dok = await res.json();
    expect(dok).toMatchObject({
      sha256: createHash("sha256").update(pdf).digest("hex"),
      groesse: pdf.byteLength,
      mimeType: "application/pdf",
      dateiname: "Rechnung-2026-11.pdf",
      quelle: "upload",
    });

    const datei = await app.request(`/api/dokumente/${dok.id}/datei`);
    expect(datei.status).toBe(200);
    expect(datei.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await datei.arrayBuffer())).toEqual(pdf);

    const [eintrag] =
      await sql`select actor, action from audit_log where table_name = 'dokumente' and row_id = ${dok.id}`;
    expect(eintrag).toEqual({ actor: "unangemeldet", action: "INSERT" });
    expect(await sql`select 1 from seals where row_id = ${dok.id}`).toHaveLength(1);
  });

  it("lehnt Ändern und Löschen eines Originals in der Datenbank ab", async () => {
    const dok = await (await hochladen(pdf, "fest.pdf")).json();
    await expect(sql`update dokumente set dateiname = 'anders.pdf' where id = ${dok.id}`).rejects.toThrow(
      /darf nur ergänzt werden/,
    );
    await expect(sql`delete from dokumente where id = ${dok.id}`).rejects.toThrow(/darf nur ergänzt werden/);
  });

  it("liefert eine veränderte Datei nicht aus", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n% wird gleich verändert\n");
    const dok = await (await hochladen(bytes, "verändert.pdf")).json();
    await writeFile(speicher.pfad(dok.sha256), "manipuliert");
    const res = await app.request(`/api/dokumente/${dok.id}/datei`);
    expect(res.status).toBe(409);
  });

  it("listet die neuesten zuerst und sucht im Dateinamen, auch mit Sonderzeichen", async () => {
    await hochladen(new TextEncoder().encode("eins"), "Vertrag_100%.txt");
    await hochladen(new TextEncoder().encode("zwei"), "Notiz.txt");
    const alle = await (await app.request("/api/dokumente")).json();
    expect(alle[0].dateiname).toBe("Notiz.txt");
    const treffer = await (await app.request(`/api/dokumente?suche=${encodeURIComponent("_100%")}`)).json();
    expect(treffer.map((d: { dateiname: string }) => d.dateiname)).toEqual(["Vertrag_100%.txt"]);
  });

  it("antwortet bei fehlender Datei, unbekannter und ungültiger ID passend", async () => {
    expect((await app.request("/api/dokumente", { method: "POST", body: new FormData() })).status).toBe(400);
    expect((await app.request("/api/dokumente/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await app.request("/api/dokumente/keine-id")).status).toBe(404);
  });

  it("meldet eine gültige Kette und findet eine an den Triggern vorbei geänderte Zeile", async () => {
    expect(await (await app.request("/api/pruefung")).json()).toEqual({ ok: true, befunde: [] });
    const dok = await (await hochladen(pdf, "später-geändert.pdf")).json();
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update dokumente set dateiname = 'gefälscht.pdf' where id = ${dok.id}`;
    });
    const ergebnis = await (await app.request("/api/pruefung")).json();
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.befunde).toContainEqual(
      expect.objectContaining({ art: "siegel", tabelle: "dokumente", zeile: dok.id }),
    );
  });
});
