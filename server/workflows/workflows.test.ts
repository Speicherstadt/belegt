import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufnehmen } from "../dokumente/dokumente.ts";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { zustellen } from "../webhooks/webhooks.ts";
import { workflowsAusfuehren } from "./ausfuehren.ts";

describe.skipIf(!testDatenbankUrl)("Workflows gegen Postgres", { timeout: 60_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let steuer: string;
  let pruefer: string;
  const senden = (cookie: string, methode: string, pfad: string, body?: unknown) =>
    t.anfrage(
      pfad,
      body === undefined
        ? { method: methode }
        : { method: methode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );
  const hochladen = async (name: string, inhalt = `Inhalt ${name}`) => {
    const f = new FormData();
    f.append("datei", new File([new TextEncoder().encode(inhalt)], name));
    return (await (await t.anfrage("/api/dokumente", { method: "POST", body: f }, inhaber)).json()) as {
      id: string;
    };
  };
  const anlegen = async (w: Record<string, unknown>) => {
    const res = await senden(inhaber, "POST", "/api/workflows", w);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return (await res.json()) as { id: string; name: string };
  };
  const tag = async (name: string) =>
    ((await (await senden(inhaber, "POST", "/api/tags", { name, farbe: "blau" })).json()) as { id: string }).id;
  const tagsVon = async (id: string) =>
    (
      await t.sql<{ name: string }[]>`
        select t.name from dokument_tags dt join tags t on t.id = dt.tag_id where dt.dokument_id = ${id} order by t.name`
    ).map((z) => z.name);
  const laeufe = async (dokumentId: string) =>
    t.sql<{ workflow_name: string; ergebnis: string; fehler: string | null }[]>`
      select workflow_name, ergebnis, fehler from workflow_laeufe where dokument_id = ${dokumentId} order by zeitpunkt, workflow_name`;
  const lauf = () => workflowsAusfuehren(t.db, { ocr: false });
  /** Alle bisherigen Workflows aus, damit jeder Test nur seine eigenen sieht */
  const alleAus = async () => {
    for (const w of (await (await senden(inhaber, "GET", "/api/workflows")).json()) as { id: string }[])
      await senden(inhaber, "POST", `/api/workflows/${w.id}/deaktivieren`);
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    steuer = await zugangAnlegen(t, inhaber, "stb@example.org", { rolle: "steuerberatung" });
    pruefer = await zugangAnlegen(t, inhaber, "pruefer@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
  });
  afterAll(() => t?.aufraeumen());

  it("nur der Inhaber legt an; die Steuerberatung liest, Prüfer und Programme nicht", async () => {
    const w = { name: "Rechte", ausloeser: "eingang", aktionen: [{ art: "webhook" }] };
    expect((await senden(steuer, "POST", "/api/workflows", w)).status).toBe(403);
    expect((await senden(pruefer, "POST", "/api/workflows", w)).status).toBe(403);
    const neu = await anlegen(w);
    expect((await senden(steuer, "GET", "/api/workflows")).status).toBe(200);
    expect((await senden(pruefer, "GET", "/api/workflows")).status).toBe(403);
    const token = await tokenAnlegen(t, inhaber, "schreiben");
    const mitToken = await t.app.request("http://localhost:3000/api/workflows", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mitToken.status).toBe(403);
    expect((await senden(inhaber, "POST", "/api/workflows", w)).status).toBe(409);
    expect((await senden(inhaber, "DELETE", `/api/workflows/${neu.id}`)).status).toBe(200);
    const log = await t.sql<{ action: string; actor: string }[]>`
      select action, actor from audit_log where table_name = 'workflows' and row_id = ${neu.id} order by seq`;
    expect(log).toEqual([
      { action: "INSERT", actor: "nutzer:anna@example.org" },
      { action: "DELETE", actor: "nutzer:anna@example.org" },
    ]);
  });

  it("einordnen nur, wenn ausdrücklich gewählt: die Schnittstelle und Postgres lehnen sonst ab", async () => {
    const ohne = {
      name: "Heimlich",
      ausloeser: "eingang",
      aktionen: [{ art: "einordnen", als: "beleg", entstanden: "eingang" }],
    };
    expect((await senden(inhaber, "POST", "/api/workflows", ohne)).status).toBe(400);
    await expect(
      t.sql`insert into workflows (name, ausloeser, aktionen)
            values ('SQL', 'eingang', ${JSON.stringify([{ art: "einordnen", als: "beleg", entstanden: "eingang" }])}::jsonb)`,
    ).rejects.toThrow(/workflows_einordnung_ausdruecklich/);
    await expect(
      t.sql`insert into workflows (name, ausloeser, aktionen)
            values ('SQL2', 'eingang', ${JSON.stringify([{ art: "einordnen", als: "beleg", ausdruecklich: "ja" }])}::jsonb)`,
    ).rejects.toThrow(/workflows_einordnung_ausdruecklich/);
    // Unbekannter Tag in einer Aktion
    const unbekannt = {
      name: "Unbekannt",
      ausloeser: "eingang",
      aktionen: [{ art: "tagsHinzu", tags: ["11111111-1111-4111-8111-111111111111"] }],
    };
    expect((await senden(inhaber, "POST", "/api/workflows", unbekannt)).status).toBe(409);
  });

  it("Auslöser eingang: Bedingungen, jede Aktion, Akteur workflow:<Name>, und ein zweiter Lauf tut nichts", async () => {
    await alleAus();
    const strom = await tag("Strom");
    const alt = await tag("Alt");
    const typ = (
      (await (await senden(inhaber, "POST", "/api/dokumenttypen", { name: "Rechnung", vorgabeArt: null })).json()) as {
        id: string;
      }
    ).id;
    const feld = (
      (await (await senden(inhaber, "POST", "/api/felder", { name: "Summe", typ: "betrag", optionen: [] })).json()) as {
        id: string;
      }
    ).id;
    const webhook = await senden(inhaber, "POST", "/api/webhooks", {
      name: "wf",
      url: "https://empfang.example/wf",
      arten: ["dokument.workflow"],
    });
    expect(webhook.status).toBe(201);
    await anlegen({
      name: "Strom",
      ausloeser: "eingang",
      bedingungen: { quellen: ["upload"], dateinameEnthaelt: "strom", mimeTyp: "text/*" },
      aktionen: [
        { art: "tagsHinzu", tags: [strom, alt] },
        { art: "tagsWeg", tags: [alt] },
        { art: "dokumenttyp", dokumenttyp: typ },
        { art: "feld", feldId: feld, wert: "12,34" },
        { art: "notiz", text: "Vom Workflow" },
        { art: "webhook" },
        { art: "einordnen", als: "beleg", entstanden: "eingang", titel: "Strom", ausdruecklich: true },
      ],
    });
    const treffer = await hochladen("strom-november.txt");
    const anderer = await hochladen("gas-november.txt");
    expect(await lauf()).toMatchObject({ ausgefuehrt: 1, fehler: 0 });

    expect(await tagsVon(treffer.id)).toEqual(["Strom"]);
    expect(await tagsVon(anderer.id)).toEqual([]);
    const [typZeile] = await t.sql`select dokumenttyp_id from dokument_dokumenttypen where dokument_id = ${treffer.id}`;
    expect(typZeile!.dokumenttyp_id).toBe(typ);
    const [wert] = await t.sql`select wert_zahl from feldwerte where dokument_id = ${treffer.id}`;
    expect(Number(wert!.wert_zahl)).toBe(1234);
    const [notiz] = await t.sql`select text, erstellt_von from notizen where dokument_id = ${treffer.id}`;
    expect(notiz).toEqual({ text: "Vom Workflow", erstellt_von: "workflow:Strom" });
    const [einordnung] = await t.sql`select art, titel from einordnungen where dokument_id = ${treffer.id}`;
    expect(einordnung).toEqual({ art: "beleg", titel: "Strom" });
    const akteure = await t.sql<{ table_name: string; actor: string }[]>`
      select distinct table_name, actor from audit_log
       where coalesce(new_value, old_value) ->> 'dokument_id' = ${treffer.id} and table_name <> 'workflow_laeufe'
         and table_name in ('dokument_tags', 'dokument_dokumenttypen', 'feldwerte', 'notizen', 'einordnungen')`;
    expect(akteure.every((a) => a.actor === "workflow:Strom")).toBe(true);
    expect(new Set(akteure.map((a) => a.table_name)).size).toBe(5);

    // Webhook-Ereignis mit dem Namen des Workflows
    const empfangen: string[] = [];
    await zustellen(t.db, t.schluessel, async (_url, init) => {
      empfangen.push(String(init.body));
      return new Response(null, { status: 200 });
    });
    expect(empfangen.map((r) => JSON.parse(r))).toEqual([
      expect.objectContaining({ art: "dokument.workflow", dokumentId: treffer.id, workflow: "Strom" }),
    ]);

    expect(await laeufe(treffer.id)).toEqual([{ workflow_name: "Strom", ergebnis: "ausgefuehrt", fehler: null }]);
    expect(await laeufe(anderer.id)).toEqual([{ workflow_name: "Strom", ergebnis: "trifft_nicht", fehler: null }]);
    // Idempotent: nichts Neues
    const [vorher] = await t.sql<{ n: number }[]>`select count(*)::int as n from audit_log`;
    expect(await lauf()).toEqual({ ausgefuehrt: 0, fehler: 0, wartet: 0 });
    const [nachher] = await t.sql<{ n: number }[]>`select count(*)::int as n from audit_log`;
    expect(nachher!.n).toBe(vorher!.n);
    // Läufe sind ein Protokoll: nur anhängen
    await expect(t.sql`update workflow_laeufe set ergebnis = 'trifft_nicht'`).rejects.toThrow(/nur anhängen/);
    await expect(t.sql`delete from workflow_laeufe`).rejects.toThrow(/nur anhängen/);
    const [kette] = await t.sql<{ n: number }[]>`select count(*)::int as n from belegt_integrity_problems(10)`;
    expect(kette!.n).toBe(0);

    // Die Verfahrensdokumentation führt den aktiven Workflow mit Auslöser, Bedingungen und Aktionen auf
    const doku = (await (await senden(inhaber, "GET", "/api/verfahrensdoku")).json()) as {
      abschnitte: { titel: string; absaetze: string[]; liste?: string[] }[];
    };
    const abschnitt = doku.abschnitte.find((x) => x.titel.startsWith("3."))!;
    expect(abschnitt.absaetze.join(" ")).toContain("Ausnahme: Workflows");
    expect(abschnitt.liste).toContainEqual(
      expect.stringMatching(
        /^Workflow „Strom“: wenn ein Dokument aufgenommen wird und Quelle hochgeladen, Dateiname enthält „strom“, Dateityp text\/\*, dann Tag Strom, Alt hinzufügen; Tag Alt entfernen; Dokumenttyp „Rechnung“ setzen; Feld „Summe“ setzen; Notiz anlegen; Webhook-Ereignis dokument.workflow; ohne Bestätigung einordnen als Buchungsbeleg/,
      ),
    );
  });

  it("Auslöser eingeordnet, Reihenfolge und Anhalten", async () => {
    await alleAus();
    const erst = await tag("Erst");
    const zweit = await tag("Zweit");
    const dritt = await tag("Dritt");
    await anlegen({ name: "Eins", ausloeser: "eingeordnet", aktionen: [{ art: "tagsHinzu", tags: [erst] }] });
    await anlegen({
      name: "Zwei",
      ausloeser: "eingeordnet",
      bedingungen: { tags: [erst] },
      aktionen: [{ art: "tagsHinzu", tags: [zweit] }],
      anhalten: true,
    });
    await anlegen({ name: "Drei", ausloeser: "eingeordnet", aktionen: [{ art: "tagsHinzu", tags: [dritt] }] });
    const d = await hochladen("ordnen.txt");
    // Im Eingang greift kein Workflow mit Auslöser eingeordnet
    await lauf();
    expect(await laeufe(d.id)).toEqual([]);
    await senden(inhaber, "POST", `/api/dokumente/${d.id}/einordnung`, { art: "frei", entstanden: "2026-01-01" });
    await lauf();
    // „Zwei“ sieht den Tag von „Eins“, weil der Reihe nach; „Drei“ hält „Zwei“ an
    expect(await tagsVon(d.id)).toEqual(["Erst", "Zweit"]);
    const ergebnisse = Object.fromEntries((await laeufe(d.id)).map((l) => [l.workflow_name, l.ergebnis]));
    expect(ergebnisse).toEqual({ Eins: "ausgefuehrt", Zwei: "ausgefuehrt", Drei: "angehalten" });
    // Eine zweite Einordnung löst nichts mehr aus: je Workflow und Dokument einmal
    await senden(inhaber, "POST", `/api/dokumente/${d.id}/einordnung`, { art: "frei", entstanden: "2026-02-01" });
    expect(await lauf()).toEqual({ ausgefuehrt: 0, fehler: 0, wartet: 0 });
  });

  it("ein Fehler rollt die Aktionen zurück und steht im Lauf; einordnen übergeht schon Eingeordnetes", async () => {
    await alleAus();
    const weg = await tag("Weg");
    await anlegen({
      name: "Kaputt",
      ausloeser: "eingang",
      bedingungen: { dateinameEnthaelt: "kaputt" },
      aktionen: [
        { art: "notiz", text: "darf nicht bleiben" },
        { art: "tagsHinzu", tags: [weg] },
      ],
    });
    // Der Tag verschwindet nach dem Anlegen
    await senden(inhaber, "DELETE", `/api/tags/${weg}`);
    const d = await hochladen("kaputt.txt");
    expect(await lauf()).toMatchObject({ ausgefuehrt: 0, fehler: 1 });
    expect(await laeufe(d.id)).toEqual([{ workflow_name: "Kaputt", ergebnis: "fehler", fehler: "Unbekannter Tag" }]);
    expect(await t.sql`select 1 from notizen where dokument_id = ${d.id}`).toHaveLength(0);
    // Nicht in jedem Lauf wieder
    expect(await lauf()).toEqual({ ausgefuehrt: 0, fehler: 0, wartet: 0 });
    const liste = (await (await senden(inhaber, "GET", "/api/workflows/laeufe")).json()) as {
      workflowName: string;
      ergebnis: string;
      fehler: string | null;
    }[];
    expect(liste[0]).toMatchObject({ workflowName: "Kaputt", ergebnis: "fehler", fehler: "Unbekannter Tag" });
  });

  it("gelöschte Dokumente bearbeitet kein Workflow, auch nicht über den Trigger", async () => {
    await alleAus();
    const w = await anlegen({ name: "Nach Löschung", ausloeser: "eingeordnet", aktionen: [{ art: "webhook" }] });
    const d = await hochladen("geloescht.txt");
    await senden(inhaber, "POST", `/api/dokumente/${d.id}/einordnung`, { art: "frei", entstanden: "2026-01-01" });
    expect((await senden(inhaber, "POST", `/api/dokumente/${d.id}/loeschung`)).status).toBe(201);
    expect(await lauf()).toEqual({ ausgefuehrt: 0, fehler: 0, wartet: 0 });
    expect(await laeufe(d.id)).toEqual([]);
    await expect(
      t.sql`insert into workflow_laeufe (workflow_id, workflow_name, dokument_id, ausloeser, ergebnis)
            values (${w.id}, 'x', ${d.id}, 'eingeordnet', 'ausgefuehrt')`,
    ).rejects.toThrow(/gelöscht/);
  });

  it("Text: wartet, bis er gelesen ist; Postfach aus der Herkunft; ältere Dokumente nicht", async () => {
    await alleAus();
    const vorher = await hochladen("vor-dem-workflow.txt", "Stadtwerke");
    const stadt = await tag("Stadtwerke");
    const buero = await tag("Büro");
    await anlegen({
      name: "Text",
      ausloeser: "eingang",
      bedingungen: { textEnthaelt: "stadtwerke" },
      aktionen: [{ art: "tagsHinzu", tags: [stadt] }],
    });
    await anlegen({
      name: "Postfach",
      ausloeser: "eingang",
      bedingungen: { postfach: "Büro" },
      aktionen: [{ art: "tagsHinzu", tags: [buero] }],
    });
    const d = await hochladen("abrechnung.txt", "Stadtwerke Beispiel, Abrechnung");
    const ausPostfach = await aufnehmen(
      { db: t.db, speicher: t.speicher },
      {
        bytes: new TextEncoder().encode("aus dem Postfach"),
        dateiname: "post.bin",
        quelle: "mail",
        akteur: "system:imap:Büro",
      },
    );
    // Der Text ist noch nicht gelesen: das Ereignis wartet
    expect((await lauf()).wartet).toBeGreaterThanOrEqual(1);
    expect(await laeufe(d.id)).toEqual([]);
    await inhalteErzeugen({ db: t.db, speicher: t.speicher }, { ocr: false });
    await lauf();
    expect(await tagsVon(d.id)).toEqual(["Stadtwerke"]);
    expect(await tagsVon(ausPostfach.id)).toEqual(["Büro"]);
    expect(await laeufe(vorher.id)).toEqual([]);
  });
});
