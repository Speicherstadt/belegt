import { mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { ignoriert, ordnerEinlesen, stabile, unterordner, type Zustand } from "./ordner.ts";

describe("stabile", () => {
  it("nimmt nur, was beim letzten Blick schon mit derselben Größe und Zeit da war", () => {
    const vorher: Zustand = new Map([
      ["fertig.pdf", { groesse: 10, mtimeMs: 1 }],
      ["waechst.pdf", { groesse: 5, mtimeMs: 1 }],
      ["beruehrt.pdf", { groesse: 7, mtimeMs: 1 }],
    ]);
    const jetzt: Zustand = new Map([
      ["fertig.pdf", { groesse: 10, mtimeMs: 1 }],
      ["waechst.pdf", { groesse: 9, mtimeMs: 2 }],
      ["beruehrt.pdf", { groesse: 7, mtimeMs: 2 }],
      ["neu.pdf", { groesse: 3, mtimeMs: 1 }],
    ]);
    expect(stabile(vorher, jetzt)).toEqual(["fertig.pdf"]);
    expect(stabile(new Map(), jetzt)).toEqual([]);
  });
});

describe("unterordner", () => {
  it("nennt jede Ebene über der Datei, oben im Ordner keine", () => {
    expect(unterordner(join("Steuer", "2026", "a.pdf"))).toEqual(["Steuer", "2026"]);
    expect(unterordner("a.pdf")).toEqual([]);
  });
});

describe("ignoriert", () => {
  it("lässt versteckte und temporäre Dateien liegen", () => {
    for (const name of [".DS_Store", ".scan.pdf", "~$brief.docx", "scan.pdf~", "scan.tmp", "x.part", "y.crdownload"])
      expect(ignoriert(name), name).toBe(true);
    for (const name of ["scan.pdf", "Rechnung 2026.PDF", "foto.jpg"]) expect(ignoriert(name), name).toBe(false);
  });
});

describe.skipIf(!testDatenbankUrl)("Eingangsordner gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let wurzel: string;
  let ordner: string;
  let zustand: Zustand;
  let n = 0;

  beforeAll(async () => {
    t = await testApp();
    wurzel = await mkdtemp(join(tmpdir(), "belegt-ordner-"));
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await rm(wurzel, { recursive: true, force: true });
  });
  beforeEach(async () => {
    ordner = join(wurzel, `eingang-${++n}`);
    await mkdir(ordner);
    zustand = new Map();
  });

  async function blick(teilen?: Parameters<typeof ordnerEinlesen>[1]["teilen"], ordnerTags = false) {
    const r = await ordnerEinlesen({ db: t.db, speicher: t.speicher }, { ordner, zustand, teilen, ordnerTags });
    zustand = r.zustand;
    return r.ergebnis;
  }
  const dokumente = (dateiname: string) =>
    t.sql`select d.quelle, d.sha256, a.nummer from dokumente d join archivnummern a on a.dokument_id = d.id
           where d.dateiname = ${dateiname}`;

  it("nimmt eine neue Datei beim zweiten Blick auf, mit Quelle ordner, und entfernt sie danach", async () => {
    await writeFile(join(ordner, "scan-1.pdf"), "%PDF-1.7\n% Scan eins\n");
    expect(await blick()).toMatchObject({ neu: 0 });
    expect(await readdir(ordner)).toEqual(["scan-1.pdf"]);
    expect(await blick()).toMatchObject({ neu: 1, doppelt: 0, fehler: [], spaeter: [] });
    expect(await readdir(ordner)).toEqual([]);
    const [d] = await dokumente("scan-1.pdf");
    expect(d).toMatchObject({ quelle: "ordner" });
    const [eintrag] =
      await t.sql`select actor from audit_log where table_name = 'dokumente' and new_value ->> 'dateiname' = 'scan-1.pdf'`;
    expect(eintrag!.actor).toBe("system:ordner");
  });

  it("wartet, solange der Scanner noch schreibt", async () => {
    const pfad = join(ordner, "langsam.pdf");
    await writeFile(pfad, "%PDF-1.7\n");
    await blick();
    await writeFile(pfad, "%PDF-1.7\n% weitere Seite\n");
    await utimes(pfad, new Date(), new Date(Date.now() + 5000));
    expect(await blick()).toMatchObject({ neu: 0 });
    expect(await readdir(ordner)).toEqual(["langsam.pdf"]);
    expect(await blick()).toMatchObject({ neu: 1 });
    expect((await t.speicher.laden((await dokumente("langsam.pdf"))[0]!.sha256)).toString()).toContain("weitere Seite");
  });

  it("entfernt eine Datei, die schon im Archiv liegt, ohne sie doppelt aufzunehmen", async () => {
    await writeFile(join(ordner, "erst.pdf"), "%PDF-1.7\n% gleich\n");
    await blick();
    await blick();
    await writeFile(join(ordner, "nochmal.pdf"), "%PDF-1.7\n% gleich\n");
    await blick();
    expect(await blick()).toMatchObject({ neu: 0, doppelt: 1 });
    expect(await readdir(ordner)).toEqual([]);
    expect(await dokumente("nochmal.pdf")).toHaveLength(0);
  });

  it("verschiebt leere und zu große Dateien nach fehler/ und löscht sie nicht", async () => {
    await writeFile(join(ordner, "leer.pdf"), "");
    const gross = join(ordner, "gross.pdf");
    await writeFile(gross, "");
    // Eine Datei mit Loch: groß im Verzeichnis, ohne 100 MB zu schreiben
    await truncate(gross, 100 * 1024 * 1024 + 1);
    await blick();
    const e = await blick();
    expect(e.neu).toBe(0);
    expect(e.fehler.map((f) => f.datei).sort()).toEqual(["gross.pdf", "leer.pdf"]);
    expect((await readdir(join(ordner, "fehler"))).sort()).toEqual(["gross.pdf", "leer.pdf"]);
    // fehler/ selbst wird nicht wieder eingelesen
    await blick();
    expect(await blick()).toMatchObject({ neu: 0, fehler: [] });
  });

  it("liest Unterordner, lässt versteckte Dateien liegen und folgt keinem Symlink nach außen", async () => {
    await mkdir(join(ordner, "Rechnungen", "2026"), { recursive: true });
    await writeFile(join(ordner, "Rechnungen", "2026", "strom.pdf"), "%PDF-1.7\n% Strom\n");
    await writeFile(join(ordner, ".versteckt.pdf"), "%PDF-1.7\n% versteckt\n");
    const draussen = join(wurzel, `draussen-${n}`);
    await mkdir(draussen);
    await writeFile(join(draussen, "geheim.pdf"), "%PDF-1.7\n% geheim\n");
    await symlink(draussen, join(ordner, "link-ordner"));
    await symlink(join(draussen, "geheim.pdf"), join(ordner, "link.pdf"));
    await blick();
    expect(await blick()).toMatchObject({ neu: 1, fehler: [] });
    expect(await dokumente("strom.pdf")).toHaveLength(1);
    expect(await dokumente("geheim.pdf")).toHaveLength(0);
    expect(await dokumente("link.pdf")).toHaveLength(0);
    expect((await readdir(ordner)).sort()).toEqual([".versteckt.pdf", "Rechnungen", "link-ordner", "link.pdf"]);
    expect(await readFile(join(draussen, "geheim.pdf"), "utf8")).toContain("geheim");
  });

  const tagsVon = async (dateiname: string) =>
    (
      await t.sql<{ name: string }[]>`select t.name from dokumente d join dokument_tags dt on dt.dokument_id = d.id
        join tags t on t.id = dt.tag_id where d.dateiname = ${dateiname} order by t.name`
    ).map((z) => z.name);

  it("setzt mit EINGANG_ORDNER_TAGS die Unterordner als Tags, legt fehlende an und nutzt vorhandene", async () => {
    await t.sql`insert into tags (name, farbe) values ('steuer', 'blau')`;
    await mkdir(join(ordner, "Steuer", "2026"), { recursive: true });
    await writeFile(join(ordner, "Steuer", "2026", "beleg-tag.pdf"), "%PDF-1.7\n% getaggt\n");
    await writeFile(join(ordner, "oben-tag.pdf"), "%PDF-1.7\n% oben\n");
    await blick(undefined, true);
    expect(await blick(undefined, true)).toMatchObject({ neu: 2, fehler: [], spaeter: [] });
    expect(await tagsVon("beleg-tag.pdf")).toEqual(["2026", "steuer"]);
    expect(await tagsVon("oben-tag.pdf")).toEqual([]);
    expect(await t.sql`select 1 from tags where lower(name) = 'steuer'`).toHaveLength(1);
    const [eintrag] = await t.sql<{ actor: string }[]>`
      select actor from audit_log where table_name = 'tags' and new_value ->> 'name' = '2026'`;
    expect(eintrag!.actor).toBe("system:ordner");
  });

  it("setzt ohne die Einstellung keine Tags", async () => {
    await mkdir(join(ordner, "Privat"), { recursive: true });
    await writeFile(join(ordner, "Privat", "ohne-tag.pdf"), "%PDF-1.7\n% ohne\n");
    await blick();
    expect(await blick()).toMatchObject({ neu: 1 });
    expect(await tagsVon("ohne-tag.pdf")).toEqual([]);
    expect(await t.sql`select 1 from tags where name = 'Privat'`).toHaveLength(0);
  });

  it("nimmt jedes Teil einer geteilten Datei als eigenes Dokument auf", async () => {
    await writeFile(join(ordner, "stapel.pdf"), "%PDF-1.7\n% Stapel\n");
    const teilen = async (bytes: Uint8Array, name: string) => [
      { bytes: bytes.slice(0, 5), dateiname: `${name}-1` },
      { bytes: bytes.slice(5), dateiname: `${name}-2` },
    ];
    await blick(teilen);
    expect(await blick(teilen)).toMatchObject({ neu: 2 });
    expect(await dokumente("stapel.pdf")).toHaveLength(0);
    expect(await dokumente("stapel.pdf-1")).toHaveLength(1);
    expect(await dokumente("stapel.pdf-2")).toHaveLength(1);
  });

  it("lässt die Datei liegen, wenn die Aufnahme scheitert, und versucht es später wieder", async () => {
    await writeFile(join(ordner, "spaeter.pdf"), "%PDF-1.7\n% später\n");
    const kaputt = async () => {
      throw new Error("Datenbank nicht erreichbar");
    };
    await blick(kaputt);
    expect(await blick(kaputt)).toMatchObject({ neu: 0, spaeter: [{ datei: "spaeter.pdf" }] });
    expect(await readdir(ordner)).toEqual(["spaeter.pdf"]);
    await blick();
    expect(await blick()).toMatchObject({ neu: 1 });
  });
});
