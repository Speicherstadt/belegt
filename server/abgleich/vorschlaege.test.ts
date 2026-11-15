import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { klassifikatorLernen } from "../lernen/lernen.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zuordnungVorschlaegeErzeugen } from "./vorschlaege.ts";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type Vorschlag = {
  zuordnung: {
    korrespondent: { id: string; name: string } | null;
    dokumenttyp: { id: string; name: string } | null;
    tags: { id: string; name: string }[];
    uebersprungen: string[];
  } | null;
  gelernt: {
    art: { wert: string; anzahl: number } | null;
    korrespondent: { id: string; name: string; anzahl: number; woerter: string[]; sicherheit: number } | null;
    dokumenttyp: { id: string; name: string } | null;
    tags: { id: string; name: string }[];
  } | null;
};

describe.skipIf(!testDatenbankUrl)("Zuordnungsregeln und gelernte Vorschläge gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const hoch = async (inhalt: string, name: string) => {
    const f = new FormData();
    f.append("datei", new File([inhalt], name, { type: "text/plain" }));
    return (await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
  };
  const anlegen = async (pfad: string, body: object) => {
    const res = await als(inhaber)(pfad, json(body));
    expect(res.status, JSON.stringify(body)).toBe(201);
    return (await res.json()) as { id: string };
  };
  const vorschlag = async (id: string) =>
    (await (await als(inhaber)(`/api/dokumente/${id}/vorschlag`)).json()) as Vorschlag;
  /** Was der Worker nach dem Eingang tut: Text lesen, dann die Zuordnungsregeln */
  const worker = async () => {
    await inhalteErzeugen(t, { ocr: false });
    return zuordnungVorschlaegeErzeugen(t.db, { ocr: false });
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("Zuordnungsregeln schlagen Korrespondent, Dokumenttyp und Tags vor, sobald der Text gelesen ist", async () => {
    const tel = await anlegen("/api/korrespondenten", {
      name: "Telekom",
      abgleich: "irgendein_wort",
      abgleichText: "telekom magenta",
    });
    await anlegen("/api/korrespondenten", { name: "Vodafone", abgleich: "exakt", abgleichText: "Vodafone GmbH" });
    const typ = await anlegen("/api/dokumenttypen", {
      name: "Rechnung",
      abgleich: "regex",
      abgleichText: "rechnung\\s+nr\\.?\\s*\\d+",
    });
    const handy = await anlegen("/api/tags", {
      name: "Handy",
      abgleich: "unscharf",
      abgleichText: "Mobilfunk Vertrag",
    });
    await anlegen("/api/tags", { name: "Strom", abgleich: "alle_woerter", abgleichText: "strom zählerstand" });
    // Ein Ausdruck mit katastrophalem Backtracking trifft nicht und hält die anderen nicht auf
    await anlegen("/api/tags", { name: "Langsam", abgleich: "regex", abgleichText: "(a+)+$" });

    const d = await hoch(`${"a".repeat(40)}!\nIhre MAGENTA Rechnung Nr. 4711 für den Mobilfunk-Vertrag`, "brief.txt");
    // Vor dem Lesen des Texts gibt es nichts auszuwerten
    expect(await zuordnungVorschlaegeErzeugen(t.db, { ocr: false })).toEqual({ ausgewertet: 0, treffer: 0 });
    expect(await worker()).toEqual({ ausgewertet: 1, treffer: 1 });
    const v = await vorschlag(d.id);
    expect(v.zuordnung).toEqual({
      korrespondent: { id: tel.id, name: "Telekom" },
      dokumenttyp: { id: typ.id, name: "Rechnung" },
      tags: [{ id: handy.id, name: "Handy", farbe: "grau" }],
      felder: [],
      uebersprungen: expect.any(Array),
    });
    // Ausgewertet wird einmal; gesetzt ist nichts
    expect(await worker()).toEqual({ ausgewertet: 0, treffer: 0 });
    const dok = await (await als(inhaber)(`/api/dokumente/${d.id}`)).json();
    expect(dok.korrespondent).toBeNull();
    expect(dok.tags).toEqual([]);

    // Übernehmen setzt die Ordnung über die gewohnte Änderung
    const ok = await als(inhaber)(
      `/api/dokumente/${d.id}/ordnung`,
      json({ korrespondent: tel.id, dokumenttyp: typ.id, tagsHinzu: [handy.id] }),
    );
    expect((await ok.json()).korrespondent).toEqual({ id: tel.id, name: "Telekom" });
  });

  it("meldet einen Ausdruck über dem Zeitlimit und wertet nach einer geänderten Regel den Eingang neu aus", async () => {
    const d = await hoch(`${"a".repeat(40)}!`, "langsam.txt");
    await worker();
    expect((await vorschlag(d.id)).zuordnung).toBeNull();
    const [z] = await t.sql`select vorschlag from zuordnung_vorschlaege where dokument_id = ${d.id}`;
    expect(z!.vorschlag.uebersprungen).toContain("Langsam");

    const [langsam] = await t.sql`select id from tags where name = 'Langsam'`;
    await als(inhaber)(`/api/tags/${langsam!.id}`, json({ abgleich: "regex", abgleichText: "a{10}!" }, "PATCH"));
    expect(await t.sql`select 1 from zuordnung_vorschlaege where dokument_id = ${d.id}`).toHaveLength(0);
    await worker();
    expect((await vorschlag(d.id)).zuordnung?.tags.map((x) => x.name)).toEqual(["Langsam"]);
    expect((await als(inhaber)(`/api/tags/${langsam!.id}`, json({ abgleichText: "x" }, "PATCH"))).status).toBe(200);
    expect(
      (await als(inhaber)(`/api/tags/${langsam!.id}`, json({ abgleich: "regex", abgleichText: "(" }, "PATCH"))).status,
    ).toBe(400);
  });

  it("lernt aus eingeordneten Dokumenten und schlägt Korrespondent und Art mit Begründung vor", async () => {
    const strom = await anlegen("/api/korrespondenten", { name: "Stadtwerke" });
    await anlegen("/api/korrespondenten", { name: "Allianz" });
    for (let i = 0; i < 6; i++) {
      const s = await hoch(`Stadtwerke Musterstadt Abschlag Strom Zählerstand Verbrauch Monat ${i}`, `strom-${i}.txt`);
      await als(inhaber)(
        `/api/dokumente/${s.id}/einordnung`,
        json({ art: "beleg", entstanden: "2026-02-01", korrespondent: "Stadtwerke" }),
      );
      const a = await hoch(`Allianz Versicherung Police Beitrag Haftpflicht Jahr ${i}`, `police-${i}.txt`);
      await als(inhaber)(
        `/api/dokumente/${a.id}/einordnung`,
        json({ art: "freiwillig", entstanden: "2026-02-01", freiwilligBis: "2036-12-31", korrespondent: "Allianz" }),
      );
    }
    await inhalteErzeugen(t, { ocr: false });
    const neu = await hoch("Ihre Stadtwerke: neuer Abschlag für Strom", "neu.txt");
    await worker();
    expect((await vorschlag(neu.id)).gelernt).toBeNull();

    expect(await klassifikatorLernen(t.db)).toEqual({ gelernt: true, beispiele: 12 });
    // Ohne Änderung lernt er nicht noch einmal
    expect((await klassifikatorLernen(t.db)).gelernt).toBe(false);
    const v = await vorschlag(neu.id);
    expect(v.gelernt?.korrespondent).toMatchObject({ id: strom.id, name: "Stadtwerke", anzahl: 6 });
    expect(v.gelernt?.korrespondent?.woerter).toEqual(expect.arrayContaining(["stadtwerke"]));
    expect(v.gelernt?.art).toMatchObject({ wert: "beleg", anzahl: 6 });

    // Eine Zuordnungsregel geht vor: Der gelernte Vorschlag nennt dann keinen Korrespondenten mehr
    await als(inhaber)(
      `/api/korrespondenten/${strom.id}`,
      json({ abgleich: "irgendein_wort", abgleichText: "abschlag" }, "PATCH"),
    );
    await worker();
    const danach = await vorschlag(neu.id);
    expect(danach.zuordnung?.korrespondent?.name).toBe("Stadtwerke");
    expect(danach.gelernt?.korrespondent ?? null).toBeNull();
    expect(danach.gelernt?.art?.wert).toBe("beleg");

    // Die Verfahrensdokumentation nennt die Regeln und den Stand des Gelernten
    const doku = JSON.stringify(await (await als(inhaber)("/api/verfahrensdoku")).json());
    expect(doku).toContain("Zuordnungsregel Korrespondent „Telekom“: irgendein Wort aus „telekom magenta“");
    expect(doku).toContain("Zuordnungsregel Dokumenttyp „Rechnung“: regulärer Ausdruck");
    expect(doku).toMatch(/Zuletzt gelernt am [0-9-]+ aus 12 Dokumenten/);
  });

  it("gelöschte Dokumente fließen nicht ins Modell, und ihre Vorschläge gehen mit der Löschung", async () => {
    await klassifikatorLernen(t.db, { immer: true });
    const zwei = [];
    for (const n of [1, 2]) {
      const d = await hoch(`Zebrastreifen Werbung Prospekt ${n}`, `werbung-${n}.txt`);
      await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-01" }));
      zwei.push(d.id);
    }
    await inhalteErzeugen(t, { ocr: false });
    await klassifikatorLernen(t.db);
    const modell = async () => (await t.sql`select modell, beispiele from klassifikator`)[0];
    expect((await modell())!.modell.wortschatz).toContain("zebrastreifen");

    const offen = await hoch("Zebrastreifen im Eingang", "eingang.txt");
    await worker();
    expect(await t.sql`select 1 from zuordnung_vorschlaege where dokument_id = ${offen.id}`).toHaveLength(1);
    await als(inhaber)(`/api/dokumente/${offen.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-01" }));

    for (const id of [...zwei, offen.id])
      expect((await als(inhaber)(`/api/dokumente/${id}/loeschung`, { method: "POST" })).status).toBe(201);
    // Mit der bestätigten Löschung ist das Modell weg, ebenso der Vorschlag der Regeln
    expect(await modell()).toBeUndefined();
    expect(await t.sql`select 1 from zuordnung_vorschlaege where dokument_id = ${offen.id}`).toHaveLength(0);
    const r = await klassifikatorLernen(t.db);
    // 12 aus dem Training davor; die drei gelöschten zählen nicht
    expect(r).toEqual({ gelernt: true, beispiele: 12 });
    expect((await modell())!.modell.wortschatz).not.toContain("zebrastreifen");
  });

  it("Postgres verwirft ein Modell aus Beispielen, die vor einer Löschung gelesen wurden", async () => {
    await t.sql`delete from klassifikator`;
    const [n] = await t.sql`select count(*)::int as n from loeschungen where bestaetigt_am is not null`;
    await t.sql`insert into klassifikator (modell, beispiele, stand, loeschungen) values ('{}', 1, 'x', ${n!.n - 1})`;
    expect(await t.sql`select 1 from klassifikator`).toHaveLength(0);
    await t.sql`insert into klassifikator (modell, beispiele, stand, loeschungen) values ('{}', 1, 'x', ${n!.n})`;
    expect(await t.sql`select 1 from klassifikator`).toHaveLength(1);
  });
});
