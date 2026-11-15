import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import type { Sicht } from "../zugang/sicht.ts";
import { sammeln as sammelnIn } from "./zuordnung.ts";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe.skipIf(!testDatenbankUrl)("Sammelbearbeitung gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, inhaber);
  const hoch = async (name: string) => {
    const f = new FormData();
    f.append("datei", new File([`${name} ${Math.random()}`], name));
    return ((await (await als("/api/dokumente", { method: "POST", body: f })).json()) as { id: string }).id;
  };
  const anlegen = async (pfad: string, body: object) =>
    ((await (await als(pfad, json(body))).json()) as { id: string }).id;
  const sammeln = (body: object) => als("/api/dokumente/sammeln", json(body));
  const zuordnungen = async (tagId: string) =>
    (await t.sql<{ dokument_id: string }[]>`select dokument_id from dokument_tags where tag_id = ${tagId}`).map(
      (z) => z.dokument_id,
    );
  const geloeschtesDokument = async () => {
    const id = await hoch("geloescht.pdf");
    await als(`/api/dokumente/${id}/einordnung`, json({ art: "frei", entstanden: "2026-01-01" }));
    expect((await als(`/api/dokumente/${id}/loeschung`, { method: "POST" })).status).toBe(201);
    return id;
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("fügt Tags vielen Dokumenten in einem Schritt hinzu, jede Zuordnung mit Akteur im Audit-Log", async () => {
    const ids = [await hoch("a.pdf"), await hoch("b.pdf"), await hoch("c.pdf")];
    const tag = await anlegen("/api/tags", { name: "Sammel" });
    const res = await sammeln({ ids, tagsHinzu: [tag] });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.ok).toBe(true);
    expect(r.ergebnisse.map((e: { id: string; ok: boolean }) => [e.id, e.ok])).toEqual(ids.map((id) => [id, true]));
    expect((await zuordnungen(tag)).sort()).toEqual([...ids].sort());
    const audit = await t.sql<{ actor: string }[]>`
      select actor from audit_log where table_name = 'dokument_tags' and new_value ->> 'tag_id' = ${tag}`;
    expect(audit.map((a) => a.actor)).toEqual(Array(3).fill("nutzer:anna@example.org"));

    const weg = await sammeln({ ids: ids.slice(0, 2), tagsWeg: [tag] });
    expect(weg.status).toBe(200);
    expect(await zuordnungen(tag)).toEqual([ids[2]]);
  });

  it("ist eine Transaktion: scheitert ein Dokument, gilt für keines etwas, und das Ergebnis nennt den Grund", async () => {
    const gut = await hoch("gut.pdf");
    const weg = await geloeschtesDokument();
    const tag = await anlegen("/api/tags", { name: "Alles oder nichts" });
    const typ = await anlegen("/api/dokumenttypen", { name: "Nichts davon" });
    const res = await sammeln({ ids: [gut, weg], tagsHinzu: [tag], dokumenttyp: typ });
    expect(res.status).toBe(409);
    const r = await res.json();
    expect(r.ok).toBe(false);
    expect(r.ergebnisse).toEqual([
      { id: gut, ok: true, eingeordnet: false },
      { id: weg, ok: false, fehler: "Das Dokument ist gelöscht" },
    ]);
    expect(await zuordnungen(tag)).toEqual([]);
    expect(await t.sql`select 1 from dokument_dokumenttypen where dokumenttyp_id = ${typ}`).toHaveLength(0);
    // Auch das Audit-Log hat nichts davon behalten
    expect(
      await t.sql`select 1 from audit_log where table_name = 'dokument_tags' and new_value ->> 'tag_id' = ${tag}`,
    ).toHaveLength(0);

    const unbekannt = await sammeln({ ids: [gut, "00000000-0000-4000-8000-000000000000"], tagsHinzu: [tag] });
    expect(unbekannt.status).toBe(409);
    expect((await unbekannt.json()).ergebnisse[1]).toMatchObject({ ok: false, fehler: "Nicht gefunden" });
    expect(await zuordnungen(tag)).toEqual([]);
  });

  it("prüft die Änderung vorab: unbekannter Tag 409, unpassender Feldwert 400, leere Änderung 400", async () => {
    const id = await hoch("vorab.pdf");
    const summe = await anlegen("/api/felder", { name: "Vorab-Summe", typ: "betrag" });
    expect((await sammeln({ ids: [id], tagsHinzu: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(409);
    expect((await sammeln({ ids: [id], felder: [{ feldId: summe, wert: "viel" }] })).status).toBe(400);
    expect((await sammeln({ ids: [id] })).status).toBe(400);
    expect((await sammeln({ ids: [], tagsHinzu: [] })).status).toBe(400);
  });

  it("setzt Dokumenttyp und Feldwert für alle gewählten", async () => {
    const ids = [await hoch("typ-a.pdf"), await hoch("typ-b.pdf")];
    const typ = await anlegen("/api/dokumenttypen", { name: "Kontoauszug", vorgabeArt: "beleg" });
    const summe = await anlegen("/api/felder", { name: "Sammelsumme", typ: "betrag" });
    const res = await sammeln({ ids, dokumenttyp: typ, felder: [{ feldId: summe, wert: "1.234,56" }] });
    expect(res.status).toBe(200);
    for (const id of ids) {
      const d = await (await als(`/api/dokumente/${id}`)).json();
      expect(d.dokumenttyp.name).toBe("Kontoauszug");
      expect(d.felder).toEqual([{ feldId: summe, name: "Sammelsumme", typ: "betrag", wert: 123456 }]);
    }
  });

  it("ordnet nur Dokumente im Eingang ein, auf Wunsch auch alle neu, mit dem Tag des Eingangs", async () => {
    const offen = [await hoch("offen-a.pdf"), await hoch("offen-b.pdf")];
    const schon = await hoch("schon.pdf");
    await als(`/api/dokumente/${schon}/einordnung`, json({ art: "geschaeftsbrief", entstanden: "2025-05-05" }));
    const res = await sammeln({
      ids: [...offen, schon],
      einordnung: { art: "beleg", entstanden: "eingang", titel: "Kontoauszug", korrespondent: "Bank" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ergebnisse.map((e: { eingeordnet: boolean }) => e.eingeordnet)).toEqual([
      true,
      true,
      false,
    ]);
    const [heute] = await t.sql<{ tag: string }[]>`select (now() at time zone 'Europe/Berlin')::date::text as tag`;
    const jahr = Number(heute!.tag.slice(0, 4));
    for (const id of offen) {
      const e = (await (await als(`/api/dokumente/${id}`)).json()).einordnung;
      expect(e).toMatchObject({
        art: "beleg",
        entstanden: heute!.tag,
        fristBis: `${jahr + 8}-12-31`,
        titel: "Kontoauszug",
      });
    }
    expect((await (await als(`/api/dokumente/${schon}`)).json()).einordnung.art).toBe("geschaeftsbrief");

    const neu = await sammeln({
      ids: [schon],
      einordnung: { art: "beleg", entstanden: "2025-05-05", nurOffene: false },
    });
    expect((await neu.json()).ergebnisse[0].eingeordnet).toBe(true);
    const e = (await (await als(`/api/dokumente/${schon}`)).json()).einordnung;
    expect(e).toMatchObject({ art: "beleg", fristBis: "2033-12-31" });
    // Die alte Einordnung bleibt versiegelt im Verlauf
    expect(await t.sql`select 1 from einordnungen where dokument_id = ${schon}`).toHaveLength(2);
  });

  it("rollt eine Einordnung zurück, die für ein Dokument nicht geht", async () => {
    const ids = [await hoch("frei-a.pdf"), await hoch("frei-b.pdf")];
    const weg = await geloeschtesDokument();
    const res = await sammeln({
      ids: [...ids, weg],
      einordnung: { art: "beleg", entstanden: "2026-02-01", nurOffene: false },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).ergebnisse[2]).toMatchObject({ ok: false, fehler: "Das Dokument ist gelöscht" });
    for (const id of ids) expect((await (await als(`/api/dokumente/${id}`)).json()).einordnung).toBeNull();

    const ohneDatum = await sammeln({ ids, einordnung: { art: "freiwillig", entstanden: "2026-02-01" } });
    expect(ohneDatum.status).toBe(409);
    expect((await ohneDatum.json()).ergebnisse[0].ok).toBe(false);
  });

  it("steht einem API-Token mit dem Recht schreiben offen, mit lesen nicht", async () => {
    const id = await hoch("token.pdf");
    const tag = await anlegen("/api/tags", { name: "Vom Programm" });
    const token = async (recht: string) =>
      (await (await als("/api/tokens", json({ name: `T ${recht}`, recht }))).json()).klartext as string;
    const mit = (klartext: string) =>
      t.app.request("http://localhost:3000/api/dokumente/sammeln", {
        ...json({ ids: [id], tagsHinzu: [tag] }),
        headers: { "content-type": "application/json", authorization: `Bearer ${klartext}` },
      });
    expect((await mit(await token("lesen"))).status).toBe(403);
    expect((await mit(await token("schreiben"))).status).toBe(200);
    const [eintrag] = await t.sql<{ actor: string }[]>`
      select actor from audit_log where table_name = 'dokument_tags' and new_value ->> 'tag_id' = ${tag}`;
    expect(eintrag!.actor).toBe("token:T schreiben");
  });
  it("prüft gleichzeitige Änderungen eines Mitarbeiters nacheinander: keine schiebt das Dokument hinaus", async () => {
    // Sichtbereich Tag A oder Tag B; das Dokument hat beide. Nimmt eine Änderung A und eine gleichzeitige B weg, sähe
    // jede für sich das Dokument noch (über den anderen Tag), zusammen läge es außerhalb (Write Skew). Das verhindert die
    // Sperre der Hash-Kette (belegt.audit_chain, bis zum Ende der Transaktion): Die zweite schreibt ihren Eintrag erst
    // nach dem Ende der ersten und prüft danach, was diese geändert hat (server/zugang/sicht.ts)
    const a = await anlegen("/api/tags", { name: "Skew A" });
    const b = await anlegen("/api/tags", { name: "Skew B" });
    const [doc, halter] = [await hoch("skew.pdf"), await hoch("halter.pdf")];
    expect((await sammeln({ ids: [doc, halter], tagsHinzu: [a, b] })).status).toBe(200);
    const sicht: Sicht = {
      bereich: { tags: [a, b], dokumenttypen: [], korrespondenten: [], ohneTags: [], ohneOrdnung: false },
      nutzerId: "mitarbeiter",
    };
    // Die erste Änderung hält bei halter an, nachdem sie doc geändert und geprüft hat: Die Zeile ist gesperrt
    // Eigene Verbindungen: die beiden des Tests brauchen die Änderungen
    const neben = postgres(testDatenbankUrl!, { max: 2, onnotice: () => {} });
    const sperre = await neben.reserve();
    await sperre`begin`;
    await sperre`select 1 from dokument_tags where dokument_id = ${halter} and tag_id = ${a} for update`;
    const erste = sammelnIn(t.db, [doc, halter], { tagsWeg: [a], tagsHinzu: [], felder: [] }, "test:eins", sicht);
    const wartet = async () => Number((await neben`select count(*) as n from pg_locks where not granted`)[0]?.n) > 0;
    for (let i = 0; i < 100 && !(await wartet()); i++) await new Promise((r) => setTimeout(r, 20));
    const zweite = sammelnIn(t.db, [doc], { tagsWeg: [b], tagsHinzu: [], felder: [] }, "test:zwei", sicht);
    await new Promise((r) => setTimeout(r, 300));
    await sperre`commit`;
    sperre.release();
    await neben.end();
    const [r1, r2] = await Promise.all([erste, zweite]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect((await zuordnungen(b)).sort()).toEqual([doc, halter].sort());
  });
});
