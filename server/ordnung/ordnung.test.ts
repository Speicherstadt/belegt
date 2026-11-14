import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe.skipIf(!testDatenbankUrl)("Tags, Dokumenttypen und Felder gegen Postgres", () => {
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
  const anlegen = async (pfad: string, body: object) => {
    const res = await als(inhaber)(pfad, json(body));
    expect(res.status, JSON.stringify(body)).toBe(201);
    return (await res.json()) as { id: string };
  };
  const ordnen = (id: string, body: object) => als(inhaber)(`/api/dokumente/${id}/ordnung`, json(body));
  const protokoll = (tabelle: string) =>
    t.sql<{ action: string; actor: string; new_value: Record<string, unknown> | null; old_value: unknown }[]>`
      select action, actor, new_value, old_value from audit_log where table_name = ${tabelle} order by seq`;
  const liste = async (abfrage: string) =>
    ((await (await als(inhaber)(`/api/dokumente?${abfrage}`)).json()) as { dateiname: string }[]).map(
      (d) => d.dateiname,
    );

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    kanzlei = await einladen({ rolle: "steuerberatung" }, "kanzlei@example.org");
    pruefer = await einladen({ rolle: "pruefer", zeitraum: { von: "2000-01-01", bis: "2100-12-31" } }, "p@example.org");
  });
  afterAll(() => t?.aufraeumen());

  it("legt Tags an, benennt sie um und lehnt doppelte Namen und fremde Farben ab", async () => {
    const tag = await anlegen("/api/tags", { name: "Steuer 2026", farbe: "blau" });
    expect((await als(inhaber)("/api/tags", json({ name: "steuer 2026" }))).status).toBe(409);
    expect((await als(inhaber)("/api/tags", json({ name: "Lila", farbe: "#ff00ff" }))).status).toBe(400);
    expect((await als(inhaber)("/api/tags", json({ name: "  " }))).status).toBe(400);
    const umbenannt = await als(inhaber)(`/api/tags/${tag.id}`, json({ name: "Steuer 2025", farbe: "rot" }, "PATCH"));
    expect(await umbenannt.json()).toMatchObject({ name: "Steuer 2025", farbe: "rot" });
    const eintraege = await protokoll("tags");
    expect(eintraege.map((e) => [e.action, e.actor])).toEqual([
      ["INSERT", "nutzer:anna@example.org"],
      ["UPDATE", "nutzer:anna@example.org"],
    ]);
  });

  it("weist Tags zu und entfernt sie, jede Änderung mit Akteur im Audit-Log und im Verlauf", async () => {
    const d = await hoch("a", "Rechnung Strom.pdf");
    const tag = await anlegen("/api/tags", { name: "Energie", farbe: "gelb" });
    const res = await ordnen(d.id, { tagsHinzu: [tag.id] });
    expect(res.status).toBe(200);
    expect((await res.json()).tags).toEqual([{ id: tag.id, name: "Energie", farbe: "gelb" }]);
    // Ein zweites Mal ändert nichts und schreibt nichts ins Protokoll
    await ordnen(d.id, { tagsHinzu: [tag.id] });
    expect((await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).tags).toHaveLength(1);
    await ordnen(d.id, { tagsWeg: [tag.id] });
    const eintraege = (await protokoll("dokument_tags")).filter(
      (e) => (e.new_value ?? (e.old_value as Record<string, unknown>))?.dokument_id === d.id,
    );
    expect(eintraege.map((e) => [e.action, e.actor])).toEqual([
      ["INSERT", "nutzer:anna@example.org"],
      ["DELETE", "nutzer:anna@example.org"],
    ]);
    const verlauf = await (await als(inhaber)(`/api/dokumente/${d.id}/verlauf`)).json();
    expect(
      verlauf.ereignisse
        .filter((e: { tabelle: string }) => e.tabelle === "dokument_tags")
        .map((e: { aktion: string; detail: string }) => [e.aktion, e.detail]),
    ).toEqual([
      ["INSERT", "Energie"],
      ["DELETE", "Energie"],
    ]);
  });

  it("löscht einen Tag samt Zuordnungen, das Dokument bleibt", async () => {
    const d = await hoch("b", "Vertrag.pdf");
    const tag = await anlegen("/api/tags", { name: "Weg damit" });
    await ordnen(d.id, { tagsHinzu: [tag.id] });
    expect((await als(inhaber)(`/api/tags/${tag.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).tags).toEqual([]);
    const geloescht = (await protokoll("dokument_tags")).filter(
      (e) => e.action === "DELETE" && (e.old_value as Record<string, unknown>).tag_id === tag.id,
    );
    expect(geloescht).toHaveLength(1);
    expect((await protokoll("tags")).at(-1)).toMatchObject({ action: "DELETE" });
    expect((await als(inhaber)(`/api/tags/${tag.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("setzt höchstens einen Dokumenttyp, mit Vorgabe-Art, und entfernt ihn wieder", async () => {
    const d = await hoch("c", "Mietvertrag.pdf");
    const vertrag = await anlegen("/api/dokumenttypen", { name: "Vertrag", vorgabeArt: "freiwillig" });
    const auszug = await anlegen("/api/dokumenttypen", { name: "Kontoauszug", vorgabeArt: "beleg" });
    expect((await als(inhaber)("/api/dokumenttypen", json({ name: "X", vorgabeArt: "quatsch" }))).status).toBe(400);
    await ordnen(d.id, { dokumenttyp: vertrag.id });
    await ordnen(d.id, { dokumenttyp: auszug.id });
    expect((await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).dokumenttyp).toEqual({
      id: auszug.id,
      name: "Kontoauszug",
      vorgabeArt: "beleg",
    });
    await ordnen(d.id, { dokumenttyp: null });
    expect((await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).dokumenttyp).toBeNull();
    expect((await protokoll("dokument_dokumenttypen")).map((e) => e.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
  });

  it("prüft Feldwerte nach Typ, speichert Beträge in Cent und schreibt jede Änderung ins Audit-Log", async () => {
    const d = await hoch("d", "Angebot.pdf");
    const betrag = await anlegen("/api/felder", { name: "Summe", typ: "betrag" });
    const datum = await anlegen("/api/felder", { name: "Fällig", typ: "datum" });
    const auswahl = await anlegen("/api/felder", { name: "Status", typ: "auswahl", optionen: ["offen", "bezahlt"] });
    const link = await anlegen("/api/felder", { name: "Vorgang", typ: "link" });
    const ja = await anlegen("/api/felder", { name: "Geprüft", typ: "ja_nein" });
    expect((await als(inhaber)("/api/felder", json({ name: "Leer", typ: "auswahl" }))).status).toBe(400);
    expect((await als(inhaber)("/api/felder", json({ name: "Zuviel", typ: "text", optionen: ["a"] }))).status).toBe(
      400,
    );

    const res = await ordnen(d.id, {
      felder: [
        { feldId: betrag.id, wert: "1.234,56" },
        { feldId: datum.id, wert: "2026-12-31" },
        { feldId: auswahl.id, wert: "offen" },
        { feldId: link.id, wert: "https://vorgang.example/42" },
        { feldId: ja.id, wert: true },
      ],
    });
    expect(res.status).toBe(200);
    const werte = Object.fromEntries(
      ((await res.json()).felder as { name: string; wert: unknown }[]).map((f) => [f.name, f.wert]),
    );
    expect(werte).toEqual({
      Summe: 123456,
      Fällig: "2026-12-31",
      Status: "offen",
      Vorgang: "https://vorgang.example/42",
      Geprüft: true,
    });
    const [zeile] = await t.sql`select wert_zahl from feldwerte where feld_id = ${betrag.id}`;
    expect(zeile!.wert_zahl).toBe("123456");

    for (const [feldId, wert] of [
      [betrag.id, "12,345"],
      [betrag.id, 12.5],
      [datum.id, "2026-02-30"],
      [auswahl.id, "storniert"],
      [link.id, "javascript:alert(1)"],
      [ja.id, "ja"],
    ] as const) {
      const r = await ordnen(d.id, { felder: [{ feldId, wert }] });
      expect(r.status, String(wert)).toBe(400);
    }
    // Eine Option, die noch genutzt wird, bleibt
    expect((await als(inhaber)(`/api/felder/${auswahl.id}`, json({ optionen: ["bezahlt"] }, "PATCH"))).status).toBe(
      409,
    );
    await ordnen(d.id, { felder: [{ feldId: betrag.id, wert: 99 }] });
    await ordnen(d.id, { felder: [{ feldId: betrag.id, wert: null }] });
    const summe = (await protokoll("feldwerte")).filter(
      (e) => (e.new_value ?? (e.old_value as Record<string, unknown>))?.feld_id === betrag.id,
    );
    expect(summe.map((e) => e.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
    expect(summe.every((e) => e.actor === "nutzer:anna@example.org")).toBe(true);
  });

  it("lehnt Änderungen durch Steuerberatung und Prüfer ab, beide lesen", async () => {
    const d = await hoch("e", "Lesen.pdf");
    const tag = await anlegen("/api/tags", { name: "Nur lesen" });
    for (const cookie of [kanzlei, pruefer]) {
      expect((await als(cookie)("/api/tags")).status).toBe(200);
      expect((await als(cookie)("/api/tags", json({ name: "Neu" }))).status).toBe(403);
      expect((await als(cookie)(`/api/tags/${tag.id}`, json({ name: "Anders" }, "PATCH"))).status).toBe(403);
      expect((await als(cookie)(`/api/tags/${tag.id}`, { method: "DELETE" })).status).toBe(403);
      expect((await als(cookie)(`/api/dokumente/${d.id}/ordnung`, json({ tagsHinzu: [tag.id] }))).status).toBe(403);
      expect((await als(cookie)("/api/dokumente/sammeln", json({ ids: [d.id], tagsHinzu: [tag.id] }))).status).toBe(
        403,
      );
    }
    expect((await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).tags).toEqual([]);
  });

  it("filtert die Liste nach Tags, Dokumenttyp und Feldern", async () => {
    const a = await hoch("f1", "filter-a.pdf");
    const b = await hoch("f2", "filter-b.pdf");
    await hoch("f3", "filter-c.pdf");
    const rot = await anlegen("/api/tags", { name: "Filter rot" });
    const blau = await anlegen("/api/tags", { name: "Filter blau" });
    const typ = await anlegen("/api/dokumenttypen", { name: "Filtertyp" });
    const summe = await anlegen("/api/felder", { name: "Filtersumme", typ: "betrag" });
    const notiz = await anlegen("/api/felder", { name: "Filternotiz", typ: "text" });
    const tag = await anlegen("/api/felder", { name: "Filtertag", typ: "datum" });
    await ordnen(a.id, {
      tagsHinzu: [rot.id, blau.id],
      dokumenttyp: typ.id,
      felder: [
        { feldId: summe.id, wert: "50,00" },
        { feldId: notiz.id, wert: "Kunde Meier" },
        { feldId: tag.id, wert: "2026-03-01" },
      ],
    });
    await ordnen(b.id, {
      tagsHinzu: [rot.id],
      felder: [
        { feldId: summe.id, wert: "1.500,00" },
        { feldId: tag.id, wert: "2026-09-01" },
      ],
    });
    const nur = (namen: string[]) => namen.filter((n) => n.startsWith("filter-")).sort();
    expect(nur(await liste(`tag=${rot.id}`))).toEqual(["filter-a.pdf", "filter-b.pdf"]);
    expect(nur(await liste(`tag=${rot.id}&tag=${blau.id}`))).toEqual(["filter-a.pdf"]);
    expect(nur(await liste(`dokumenttyp=${typ.id}`))).toEqual(["filter-a.pdf"]);
    expect(nur(await liste("dokumenttyp=ohne"))).toEqual(["filter-b.pdf", "filter-c.pdf"]);
    expect(nur(await liste(`feld.${notiz.id}=gesetzt`))).toEqual(["filter-a.pdf"]);
    expect(nur(await liste(`feld.${notiz.id}.enthaelt=meier`))).toEqual(["filter-a.pdf"]);
    expect(nur(await liste(`feld.${summe.id}.von=${encodeURIComponent("100,00")}`))).toEqual(["filter-b.pdf"]);
    expect(nur(await liste(`feld.${summe.id}.von=0&feld.${summe.id}.bis=10000`))).toEqual(["filter-a.pdf"]);
    expect(nur(await liste(`feld.${tag.id}.von=2026-01-01&feld.${tag.id}.bis=2026-06-30`))).toEqual(["filter-a.pdf"]);
    const eintrag = (
      (await (await als(inhaber)(`/api/dokumente?tag=${blau.id}`)).json()) as {
        tags: { name: string }[];
        dokumenttyp: { name: string } | null;
      }[]
    )[0]!;
    expect(eintrag.tags.map((x) => x.name)).toEqual(["Filter blau", "Filter rot"]);
    expect(eintrag.dokumenttyp?.name).toBe("Filtertyp");
    // Unpassende Filter sind ein Fehler, kein leerer Treffer
    expect((await als(inhaber)("/api/dokumente?tag=kein-uuid")).status).toBe(400);
    expect((await als(inhaber)(`/api/dokumente?feld.${summe.id}.von=abc`)).status).toBe(400);
    expect((await als(inhaber)(`/api/dokumente?feld.${summe.id}.enthaelt=x`)).status).toBe(400);
  });

  it("findet Dokumente über Tag, Typ und Textfelder, auch nach dem Umbenennen", async () => {
    const d = await hoch("g", "suche-ordnung.pdf");
    const tag = await anlegen("/api/tags", { name: "Fahrzeugkosten" });
    const typ = await anlegen("/api/dokumenttypen", { name: "Werkstattauftrag" });
    const notiz = await anlegen("/api/felder", { name: "Kennzeichen", typ: "text" });
    await ordnen(d.id, { tagsHinzu: [tag.id], dokumenttyp: typ.id, felder: [{ feldId: notiz.id, wert: "BXQ4711" }] });
    expect(await liste("suche=Fahrzeugkosten")).toEqual(["suche-ordnung.pdf"]);
    expect(await liste("suche=Werkstattauftrag")).toEqual(["suche-ordnung.pdf"]);
    expect(await liste("suche=BXQ4711")).toEqual(["suche-ordnung.pdf"]);
    await als(inhaber)(`/api/tags/${tag.id}`, json({ name: "Kfz-Kosten" }, "PATCH"));
    expect(await liste("suche=Fahrzeugkosten")).toEqual([]);
    expect(await liste(`suche=${encodeURIComponent('"Kfz-Kosten"')}`)).toEqual(["suche-ordnung.pdf"]);
    await als(inhaber)(`/api/tags/${tag.id}`, { method: "DELETE" });
    expect(await liste(`suche=${encodeURIComponent('"Kfz-Kosten"')}`)).toEqual([]);
  });

  it("nach der Löschung: Metadaten bleiben, neue lehnt Postgres ab, der gelöschte Inhalt ist nicht mehr zu finden", async () => {
    const d = await hoch("h", "weg.pdf");
    const tag = await anlegen("/api/tags", { name: "Aufgehoben" });
    const neu = await anlegen("/api/tags", { name: "Zu spät" });
    await ordnen(d.id, { tagsHinzu: [tag.id] });
    await t.sql`insert into inhalte (dokument_id, text) values (${d.id}, 'Kündigungsschreiben Zauberwort')`;
    expect(await liste("suche=Zauberwort")).toEqual(["weg.pdf"]);
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-01" }));
    expect((await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);

    expect(await liste("gruppe=geloescht&suche=Zauberwort")).toEqual([]);
    expect(await liste("gruppe=geloescht&suche=Aufgehoben")).toEqual(["weg.pdf"]);
    expect(
      (await (await als(inhaber)(`/api/dokumente/${d.id}`)).json()).tags.map((x: { name: string }) => x.name),
    ).toEqual(["Aufgehoben"]);
    const res = await ordnen(d.id, { tagsHinzu: [neu.id] });
    expect(res.status).toBe(409);
    expect((await res.json()).fehler).toBe("Das Dokument ist gelöscht");
    await expect(t.sql`insert into dokument_tags (dokument_id, tag_id) values (${d.id}, ${neu.id})`).rejects.toThrow(
      /gelöscht/,
    );
    // Entfernen geht weiter, etwa wenn der Tag gelöscht wird
    expect((await ordnen(d.id, { tagsWeg: [tag.id] })).status).toBe(200);
  });

  it("lässt den Typ eines Feldes nicht ändern, auch nicht an der Schnittstelle vorbei", async () => {
    const f = await anlegen("/api/felder", { name: "Fest", typ: "zahl" });
    await expect(t.sql`update felder set typ = 'text' where id = ${f.id}`).rejects.toThrow(/Typ eines Feldes/);
  });
});
