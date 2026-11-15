import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe.skipIf(!testDatenbankUrl)("Korrespondenten als Liste gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  let pruefer: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const hoch = async (inhalt: string, name: string) => {
    const f = new FormData();
    f.append("datei", new File([inhalt], name));
    return (await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
  };
  const einladen = async (body: object, email: string) => {
    const { pfad } = await (await als(inhaber)("/api/einladungen", json(body))).json();
    return (await t.registrieren(email, "ein-langes-passwort", { "x-belegt-einladung": pfad.split("/").pop() })).cookie;
  };
  const einordnen = async (id: string, korrespondent: string, entstanden = "2026-03-01") => {
    const res = await als(inhaber)(
      `/api/dokumente/${id}/einordnung`,
      json({ art: "beleg", entstanden, korrespondent }),
    );
    expect(res.status).toBe(201);
  };
  const korrespondenten = async (cookie = inhaber) =>
    (await (await als(cookie)("/api/korrespondenten")).json()) as { id: string; name: string; anzahl: number }[];
  const finden = async (name: string) => (await korrespondenten()).find((k) => k.name === name)!;
  const liste = async (abfrage: string, cookie = inhaber) =>
    (
      (await (await als(cookie)(`/api/dokumente?${abfrage}`)).json()) as {
        dateiname: string;
        korrespondent: { name: string } | null;
      }[]
    ).map((d) => `${d.dateiname}:${d.korrespondent?.name ?? "–"}`);
  const siegel = () =>
    t.sql<{ row_id: string; digest: string }[]>`
      select row_id, digest from seals where table_name = 'einordnungen' order by row_id`;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    kanzlei = await einladen({ rolle: "steuerberatung" }, "kanzlei@example.org");
    pruefer = await einladen({ rolle: "pruefer", zeitraum: { von: "2025-01-01", bis: "2025-12-31" } }, "p@example.org");
  });
  afterAll(() => t?.aufraeumen());

  it("Einordnen legt den Korrespondenten in der Liste an und erkennt Schreibweisen ohne Groß- und Kleinschreibung", async () => {
    const a = await hoch("a", "strom-a.pdf");
    const b = await hoch("b", "strom-b.pdf");
    await einordnen(a.id, "Stadtwerke Musterstadt");
    await einordnen(b.id, "  stadtwerke musterstadt ");
    const k = await finden("Stadtwerke Musterstadt");
    expect(k.anzahl).toBe(2);
    expect((await korrespondenten()).filter((x) => /stadtwerke/i.test(x.name))).toHaveLength(1);
    // Die Einordnung hält den Namen der Liste fest, wie er beim Einordnen hieß
    const [e] = await t.sql`select korrespondent from einordnungen where dokument_id = ${b.id}`;
    expect(e!.korrespondent).toBe("Stadtwerke Musterstadt");
    expect((await (await als(inhaber)(`/api/dokumente/${b.id}`)).json()).korrespondent).toEqual({
      id: k.id,
      name: "Stadtwerke Musterstadt",
    });
  });

  it("legt an, lehnt doppelte Namen und ungültige reguläre Ausdrücke ab; nur der Inhaber verwaltet", async () => {
    const res = await als(inhaber)(
      "/api/korrespondenten",
      json({ name: "Telekom", abgleich: "irgendein_wort", abgleichText: "telekom magenta" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Telekom", abgleich: "irgendein_wort", grossKleinEgal: true });
    expect((await als(inhaber)("/api/korrespondenten", json({ name: "TELEKOM" }))).status).toBe(409);
    expect(
      (await als(inhaber)("/api/korrespondenten", json({ name: "X", abgleich: "regex", abgleichText: "(a" }))).status,
    ).toBe(400);
    expect((await als(inhaber)("/api/korrespondenten", json({ name: "Y", abgleich: "regex" }))).status).toBe(400);
    expect((await als(inhaber)("/api/korrespondenten", json({ name: "Z", abgleich: "magisch" }))).status).toBe(400);
    // Unscharf vergleicht jedes Stück des Texts mit dem ganzen Muster; ein langes Muster wäre zu teuer
    const unscharf = (abgleichText: string) => json({ name: "Unscharf", abgleich: "unscharf", abgleichText });
    expect((await als(inhaber)("/api/korrespondenten", unscharf("a".repeat(101)))).status).toBe(400);
    expect((await als(inhaber)("/api/tags", unscharf("a".repeat(101)))).status).toBe(400);
    for (const cookie of [kanzlei, pruefer])
      expect((await als(cookie)("/api/korrespondenten", json({ name: "Fremd" }))).status).toBe(403);
    const [eintrag] = await t.sql`select actor from audit_log where table_name = 'korrespondenten'
                                   and new_value ->> 'name' = 'Telekom'`;
    expect(eintrag!.actor).toBe("nutzer:anna@example.org");
  });

  it("Umbenennen ändert die Anzeige, nicht die versiegelte Einordnung und nicht den Verlauf", async () => {
    const d = await hoch("c", "gas.pdf");
    await einordnen(d.id, "Gaswerk Alt");
    const vorher = await siegel();
    const k = await finden("Gaswerk Alt");
    const res = await als(inhaber)(`/api/korrespondenten/${k.id}`, json({ name: "Gaswerk Neu" }, "PATCH"));
    expect(res.status).toBe(200);
    expect((await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).korrespondent.name).toBe("Gaswerk Neu");
    expect(await liste("suche=Gaswerk")).toEqual(["gas.pdf:Gaswerk Neu"]);
    expect(await liste('suche="Gaswerk Neu"')).toEqual(["gas.pdf:Gaswerk Neu"]);
    const [e] = await t.sql`select korrespondent from einordnungen where dokument_id = ${d.id}`;
    expect(e!.korrespondent).toBe("Gaswerk Alt");
    expect(await siegel()).toEqual(vorher);
    const verlauf = (await (await als(inhaber)(`/api/dokumente/${d.id}/verlauf`)).json()) as {
      ereignisse: { tabelle: string; detail: string | null }[];
    };
    expect(verlauf.ereignisse.find((x) => x.tabelle === "einordnungen")!.detail).toBe("Gaswerk Alt");
    expect(verlauf.ereignisse.find((x) => x.tabelle === "dokument_korrespondenten")!.detail).toBe("Gaswerk Neu");
    expect(await (await als(inhaber)("/api/pruefung")).json()).toMatchObject({ ok: true, befunde: [] });
  });

  it("führt zwei Schreibweisen zusammen: Dokumente, Regeln und Workflows nennen danach die verbleibende", async () => {
    const x = await hoch("x", "vers-1.pdf");
    const y = await hoch("y", "vers-2.pdf");
    await einordnen(x.id, "Allianz");
    await einordnen(y.id, "Allianz Versicherung AG");
    const alt = await finden("Allianz Versicherung AG");
    const ziel = await finden("Allianz");
    const regel = await (
      await als(inhaber)(
        "/api/regeln",
        json({ name: "Allianz", wenn: { domain: "allianz.de" }, ordnung: { korrespondent: alt.id } }),
      )
    ).json();
    expect(regel.ordnung).toMatchObject({ korrespondent: alt.id });
    const wf = await als(inhaber)(
      "/api/workflows",
      json({
        name: "Versicherung",
        ausloeser: "eingang",
        bedingungen: { korrespondent: alt.id },
        aktionen: [{ art: "korrespondent", korrespondent: alt.id }],
      }),
    );
    expect(wf.status).toBe(201);
    const vorher = await siegel();

    expect((await als(inhaber)(`/api/korrespondenten/${alt.id}/zusammenfuehren`, json({ ziel: alt.id }))).status).toBe(
      409,
    );
    const res = await als(inhaber)(`/api/korrespondenten/${alt.id}/zusammenfuehren`, json({ ziel: ziel.id }));
    expect(res.status).toBe(200);
    expect(await liste("suche=vers")).toEqual(["vers-2.pdf:Allianz", "vers-1.pdf:Allianz"]);
    expect((await korrespondenten()).map((k) => k.name)).not.toContain("Allianz Versicherung AG");
    expect((await finden("Allianz")).anzahl).toBe(2);
    // Die versiegelte Einordnung behält den Text von damals
    const [e] = await t.sql`select korrespondent from einordnungen where dokument_id = ${y.id}`;
    expect(e!.korrespondent).toBe("Allianz Versicherung AG");
    expect(await siegel()).toEqual(vorher);
    const [r] = await t.sql`select ordnung from regeln where id = ${regel.id}`;
    expect(r!.ordnung.korrespondent).toBe(ziel.id);
    const [w] = await t.sql`select bedingungen, aktionen from workflows where name = 'Versicherung'`;
    expect(w!.bedingungen.korrespondent).toBe(ziel.id);
    expect(w!.aktionen[0].korrespondent).toBe(ziel.id);
    const eintraege = await t.sql`select action, actor from audit_log
                                   where table_name = 'dokument_korrespondenten' and action = 'UPDATE'`;
    expect(eintraege.length).toBeGreaterThanOrEqual(1);
    expect(await (await als(inhaber)("/api/pruefung")).json()).toMatchObject({ ok: true, befunde: [] });
  });

  it("löscht nur ohne Verwendung; Zuordnungen gelöschter Dokumente stehen dem nicht im Weg", async () => {
    const leer = await (await als(inhaber)("/api/korrespondenten", json({ name: "Niemand" }))).json();
    expect((await als(inhaber)(`/api/korrespondenten/${leer.id}`, { method: "DELETE" })).status).toBe(200);
    const genutzt = await finden("Stadtwerke Musterstadt");
    const nein = await als(inhaber)(`/api/korrespondenten/${genutzt.id}`, { method: "DELETE" });
    expect(nein.status).toBe(409);
    expect((await nein.json()).fehler).toMatch(/zusammenführen/);

    const d = await hoch("w", "werbung.txt");
    await als(inhaber)(
      `/api/dokumente/${d.id}/einordnung`,
      json({ art: "frei", entstanden: "2026-01-01", korrespondent: "Werbung GmbH" }),
    );
    const w = await finden("Werbung GmbH");
    expect((await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    // Nach der Löschung kein neuer Korrespondent
    expect((await als(inhaber)(`/api/dokumente/${d.id}/ordnung`, json({ korrespondent: genutzt.id }))).status).toBe(
      409,
    );
    expect((await finden("Werbung GmbH")).anzahl).toBe(0);
    expect((await als(inhaber)(`/api/korrespondenten/${w.id}`, { method: "DELETE" })).status).toBe(200);
    const [e] = await t.sql`select korrespondent from einordnungen where dokument_id = ${d.id}`;
    expect(e!.korrespondent).toBe("Werbung GmbH");
  });

  it("filtert das Archiv nach Korrespondent und ohne; ändert ihn einzeln und in der Sammelbearbeitung", async () => {
    const k = await finden("Stadtwerke Musterstadt");
    expect(await liste(`korrespondent=${k.id}`)).toEqual([
      "strom-b.pdf:Stadtwerke Musterstadt",
      "strom-a.pdf:Stadtwerke Musterstadt",
    ]);
    const frei = await hoch("f", "ohne.pdf");
    expect(await liste("korrespondent=ohne")).toContain("ohne.pdf:–");
    expect((await als(inhaber)("/api/dokumente?korrespondent=kaputt")).status).toBe(400);

    const tel = await finden("Telekom");
    const r = await als(inhaber)(`/api/dokumente/${frei.id}/ordnung`, json({ korrespondent: tel.id }));
    expect((await r.json()).korrespondent).toEqual({ id: tel.id, name: "Telekom" });
    const sammel = await als(inhaber)(
      "/api/dokumente/sammeln",
      json({ ids: [frei.id], korrespondent: k.id, tagsHinzu: [], tagsWeg: [], felder: [] }),
    );
    expect(sammel.status).toBe(200);
    expect(await liste(`korrespondent=${k.id}`)).toContain("ohne.pdf:Stadtwerke Musterstadt");
    await als(inhaber)(`/api/dokumente/${frei.id}/ordnung`, json({ korrespondent: null }));
    expect(await liste("korrespondent=ohne")).toContain("ohne.pdf:–");
    const unbekannt = await als(inhaber)(
      `/api/dokumente/${frei.id}/ordnung`,
      json({ korrespondent: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(unbekannt.status).toBe(409);
  });

  it("Prüfer sieht nur Korrespondenten mit Dokumenten seines Zeitraums, gezählt nur diese", async () => {
    const alt = await hoch("p", "2025.pdf");
    await einordnen(alt.id, "Stadtwerke Musterstadt", "2025-06-01");
    const sicht = await korrespondenten(pruefer);
    expect(sicht).toEqual([expect.objectContaining({ name: "Stadtwerke Musterstadt", anzahl: 1 })]);
    expect(await liste("suche=Stadtwerke", pruefer)).toEqual(["2025.pdf:Stadtwerke Musterstadt"]);
    expect((await korrespondenten(kanzlei)).length).toBeGreaterThan(1);
  });
});
