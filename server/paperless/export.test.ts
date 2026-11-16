import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { naechsterImport } from "./ausfuehren.ts";
import { fehlerMeldung } from "./kern.ts";

const text = (t: string) => new TextEncoder().encode(t);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Ein selbst gebauter Export im Format des document_exporter mit --zip */
function exportZip() {
  const a = text("%PDF-1.4\n% Versicherung\n");
  const b = text("%PDF-1.4\n% Kaputt\n");
  const manifest = [
    { model: "auth.user", pk: 1, fields: { username: "bernd", password: "pbkdf2_sha256$geheim" } },
    { model: "documents.correspondent", pk: 4, fields: { name: "Versicherung AG" } },
    { model: "documents.documenttype", pk: 2, fields: { name: "Police" } },
    { model: "documents.tag", pk: 8, fields: { name: "Versicherung" } },
    { model: "documents.customfield", pk: 1, fields: { name: "Beitrag", data_type: "monetary", extra_data: null } },
    {
      model: "documents.document",
      pk: 11,
      fields: {
        title: "Police 2026",
        correspondent: 4,
        document_type: 2,
        tags: [8],
        created: "2026-01-02",
        archive_serial_number: 5,
        original_filename: "police.pdf",
        checksum: sha(a),
        deleted_at: null,
        root_document: null,
      },
      __exported_file_name__: "originals/police.pdf",
      __exported_archive_name__: "archive/police.pdf",
    },
    {
      model: "documents.document",
      pk: 12,
      fields: {
        title: "Kaputt",
        tags: [],
        original_filename: "kaputt.pdf",
        checksum: sha(text("anders")),
        deleted_at: null,
      },
      __exported_file_name__: "originals/kaputt.pdf",
    },
    {
      model: "documents.document",
      pk: 13,
      fields: { title: "Ohne Datei", tags: [], checksum: sha(text("x")), deleted_at: null },
    },
    { model: "documents.document", pk: 14, fields: { title: "Papierkorb", deleted_at: "2026-01-01T00:00:00Z" } },
    {
      model: "documents.note",
      pk: 1,
      fields: { document: 11, note: "Kündigungsfrist 3 Monate", user: 1, created: "2026-01-05T08:00:00Z" },
    },
    { model: "documents.customfieldinstance", pk: 1, fields: { document: 11, field: 1, value_monetary: "EUR120.00" } },
  ];
  return zipSync({
    "manifest.json": text(JSON.stringify(manifest)),
    "metadata.json": text('{"version": "2.20.0"}'),
    "originals/police.pdf": a,
    "archive/police.pdf": text("%PDF Archivversion"),
    "originals/kaputt.pdf": b,
  });
}

describe("Meldung eines Fehlers am Import", () => {
  it("nennt bei Fehlern der Datenbank nur den Code, nie Anfrage und Parameter", () => {
    // So packt Drizzle einen Fehler von Postgres ein; das Ergebnis je Dokument ist versiegelt und überlebt die Löschung
    const drizzle = new Error('Failed query: insert into "notizen" ...\nparams: Geheime Notiz', {
      cause: Object.assign(new Error("invalid byte sequence"), { severity: "ERROR", code: "22021" }),
    });
    expect(fehlerMeldung(drizzle)).toBe("Die Datenbank lehnt ab (22021)");
    const trigger = new Error("Failed query: ...", {
      cause: Object.assign(new Error("Das Dokument ist gelöscht"), { severity: "ERROR", code: "23514" }),
    });
    expect(fehlerMeldung(trigger)).toBe("Das Dokument ist gelöscht");
    expect(fehlerMeldung(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }))).toBe(
      "ENOENT: no such file",
    );
  });
});

describe.skipIf(!testDatenbankUrl)("Import aus einem Export von Paperless-ngx", { timeout: 60_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let ordner: string;
  const hochladen = (bytes: Uint8Array, cookie = inhaber, name = "export.zip") =>
    t.anfrage(
      `/api/paperless/export?name=${name}`,
      { method: "POST", headers: { "content-type": "application/zip" }, body: Buffer.from(bytes) },
      cookie,
    );
  const lauf = () =>
    naechsterImport({ db: t.db, speicher: t.speicher }, { schluessel: t.schluessel, importOrdner: ordner });

  beforeAll(async () => {
    ordner = await mkdtemp(join(tmpdir(), "belegt-export-"));
    t = await testApp({ importOrdner: ordner });
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await rm(ordner, { recursive: true, force: true });
  });

  it("nimmt nur ZIPs vom Inhaber an", async () => {
    const steuer = await zugangAnlegen(t, inhaber, "stb@example.org", { rolle: "steuerberatung" });
    expect((await hochladen(exportZip(), steuer)).status).toBe(403);
    const keins = await hochladen(text("kein zip"));
    expect(keins.status).toBe(400);
    expect(await readdir(ordner)).toEqual([]);
  });

  it("übernimmt Originale nach __exported_file_name__ und prüft die Prüfsumme", async () => {
    const res = await hochladen(exportZip());
    expect(res.status).toBe(201);
    const l = (await res.json()) as { id: string; status: string; dateiname: string };
    expect(l).toMatchObject({ status: "wartet", dateiname: "export.zip" });
    expect(await readdir(ordner)).toEqual([`${l.id}.zip`]);

    expect(await lauf()).toMatchObject({ id: l.id, status: "fertig" });
    // Der Export liegt danach nicht mehr im Importordner
    expect(await readdir(ordner)).toEqual([]);
    const [stand] = (await (await t.anfrage("/api/paperless/importe", {}, inhaber)).json()) as {
      gesamt: number;
      uebernommen: number;
      fehler: number;
      hinweise: string[];
    }[];
    expect(stand).toMatchObject({ gesamt: 3, uebernommen: 1, fehler: 2 });
    expect(stand!.hinweise).toContain("1 Dokument im Papierkorb von Paperless-ngx nicht übernommen");
    const fehler = await (await t.anfrage(`/api/paperless/importe/${l.id}/fehler`, {}, inhaber)).json();
    expect(fehler).toEqual([
      { paperlessId: 12, titel: "Kaputt", grund: "Prüfsumme passt nicht zum geladenen Original" },
      { paperlessId: 13, titel: "Ohne Datei", grund: "Original fehlt im Export (exportiert mit --data-only?)" },
    ]);

    const [d] = await t.sql<{ id: string; dateiname: string; quelle: string; sha256: string }[]>`
      select id, dateiname, quelle, sha256 from dokumente`;
    expect(d).toMatchObject({
      dateiname: "police.pdf",
      quelle: "import",
      sha256: sha(text("%PDF-1.4\n% Versicherung\n")),
    });
    const dok = (await (await t.anfrage(`/api/dokumente/${d!.id}`, {}, inhaber)).json()) as {
      tags: { name: string }[];
      dokumenttyp: { name: string };
      felder: { name: string; wert: unknown }[];
      einordnung: unknown;
    };
    expect(dok.tags.map((x) => x.name)).toEqual(["Versicherung"]);
    expect(dok.dokumenttyp.name).toBe("Police");
    expect(dok.einordnung).toBeNull();
    expect(Object.fromEntries(dok.felder.map((f) => [f.name, f.wert]))).toEqual({ Beitrag: 12000, "Paperless-ASN": 5 });
    const notizen = (await (await t.anfrage(`/api/dokumente/${d!.id}/notizen`, {}, inhaber)).json()) as {
      text: string;
    }[];
    expect(notizen[0]!.text).toBe("Kündigungsfrist 3 Monate\n\n(Paperless-ngx: bernd, 2026-01-05T08:00:00Z)");
    const vorschlag = await (await t.anfrage(`/api/dokumente/${d!.id}/vorschlag`, {}, inhaber)).json();
    expect(vorschlag).toMatchObject({
      import: { titel: "Police 2026", korrespondent: "Versicherung AG", entstanden: "2026-01-02" },
    });

    // Derselbe Export ein zweites Mal: nichts doppelt, nur verknüpft
    const zweiter = (await (await hochladen(exportZip())).json()) as { id: string };
    expect(await lauf()).toMatchObject({ id: zweiter.id, status: "fertig" });
    expect((await t.sql`select id from dokumente`).length).toBe(1);
    const [e] = await t.sql<{ ergebnis: string }[]>`
      select ergebnis from import_eintraege where import_id = ${zweiter.id} and paperless_id = 11`;
    expect(e!.ergebnis).toBe("doppelt");
  });

  it("übernimmt ein Dokument mit Nullzeichen in Titel, Dateiname und Notiz, ohne die Zeichen", async () => {
    // Postgres speichert kein U+0000 in text; Paperless-ngx mit SQLite oder MariaDB schon
    const original = text("%PDF-1.4\n% Nullzeichen\n");
    const manifest = [
      { model: "documents.correspondent", pk: 1, fields: { name: "Firma\u0000 GmbH" } },
      {
        model: "documents.document",
        pk: 31,
        fields: {
          title: "Rech\u0000nung",
          correspondent: 1,
          tags: [],
          original_filename: "rech\u0000nung.pdf",
          checksum: sha(original),
          deleted_at: null,
        },
        __exported_file_name__: "originals/null.pdf",
      },
      { model: "documents.note", pk: 9, fields: { document: 31, note: "Not\u0000iz", user: null } },
    ];
    const zip = zipSync({ "manifest.json": text(JSON.stringify(manifest)), "originals/null.pdf": original });
    const l = (await (await hochladen(zip)).json()) as { id: string };
    expect(await lauf()).toMatchObject({ id: l.id, status: "fertig" });
    const [e] = await t.sql<{ ergebnis: string; titel: string; korrespondent: string; dokument_id: string }[]>`
      select ergebnis, titel, korrespondent, dokument_id from import_eintraege where import_id = ${l.id}`;
    expect(e).toMatchObject({ ergebnis: "uebernommen", titel: "Rechnung", korrespondent: "Firma GmbH" });
    const [d] = await t.sql<{ dateiname: string }[]>`select dateiname from dokumente where id = ${e!.dokument_id}`;
    expect(d!.dateiname).toBe("rechnung.pdf");
    const [n] = await t.sql<{ text: string }[]>`select text from notizen where dokument_id = ${e!.dokument_id}`;
    expect(n!.text).toMatch(/^Notiz\n/);
  });

  it("zeigt den Vorschlag aus Paperless-ngx nach der Löschung des Dokuments nicht mehr", async () => {
    const original = text("%PDF-1.4\n% Wird geloescht\n");
    const manifest = [
      {
        model: "documents.document",
        pk: 41,
        fields: { title: "Privates Schreiben", tags: [], checksum: sha(original), created: "2026-02-03" },
        __exported_file_name__: "originals/weg.pdf",
      },
    ];
    const zip = zipSync({ "manifest.json": text(JSON.stringify(manifest)), "originals/weg.pdf": original });
    const l = (await (await hochladen(zip)).json()) as { id: string };
    expect(await lauf()).toMatchObject({ id: l.id, status: "fertig" });
    const [e] = await t.sql<
      { dokument_id: string }[]
    >`select dokument_id from import_eintraege where import_id = ${l.id}`;
    const id = e!.dokument_id;
    const vorschlag = async () => (await t.anfrage(`/api/dokumente/${id}/vorschlag`, {}, inhaber)).json();
    expect((await vorschlag()).import).toMatchObject({ titel: "Privates Schreiben" });
    const post = (pfad: string, body?: unknown) =>
      t.anfrage(
        pfad,
        { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : null },
        inhaber,
      );
    expect((await post(`/api/dokumente/${id}/einordnung`, { art: "frei", entstanden: "2026-02-03" })).status).toBe(201);
    expect((await post(`/api/dokumente/${id}/loeschung`)).status).toBe(201);
    // Das Ergebnis des Imports bleibt versiegelt; als Vorschlag zeigt es Belegt nach der Löschung nicht mehr, wie den
    // Vorschlag des Sprachmodells, der mit der Löschung geht
    expect((await vorschlag()).import).toBeNull();
  });

  it("beendet den Lauf mit Fehler, wenn das Manifest fehlt, und bricht einen wartenden sofort ab", async () => {
    const ohne = (await (await hochladen(zipSync({ "a.pdf": text("a") }))).json()) as { id: string };
    const r = await lauf();
    expect(r).toMatchObject({ id: ohne.id, status: "fehler" });
    expect(r!.meldung).toContain("manifest.json fehlt");

    const wartet = (await (await hochladen(exportZip())).json()) as { id: string };
    const ab = await t.anfrage(`/api/paperless/importe/${wartet.id}/abbrechen`, { method: "POST" }, inhaber);
    expect(ab.status).toBe(200);
    expect(await readdir(ordner)).toEqual([]);
    expect(await lauf()).toBeNull();
  });
});
