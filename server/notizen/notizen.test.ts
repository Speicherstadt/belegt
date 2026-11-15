import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";

describe.skipIf(!testDatenbankUrl)("Notizen gegen Postgres", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let steuer: string;
  let pruefer: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const post = (cookie: string, pfad: string, body?: unknown) =>
    t.anfrage(
      pfad,
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );
  const hoch = async (name: string, entstanden = "2024-05-01") => {
    const f = new FormData();
    f.append("datei", new File([new TextEncoder().encode(`Inhalt ${name}`)], name));
    const d = (await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
    await post(inhaber, `/api/dokumente/${d.id}/einordnung`, { art: "frei", entstanden });
    return d;
  };
  const notizen = async (id: string, cookie = inhaber) =>
    (await (await als(cookie)(`/api/dokumente/${id}/notizen`)).json()) as {
      id: string;
      text: string;
      erstelltVon: string;
    }[];
  const suche = async (q: string, cookie = inhaber) =>
    ((await (await als(cookie)(`/api/dokumente?suche=${encodeURIComponent(q)}`)).json()) as { id: string }[]).map(
      (d) => d.id,
    );

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

  it("Inhaber und Steuerberatung schreiben Notizen, der Prüfer sieht keine", async () => {
    const d = await hoch("rechnung.txt");
    const res = await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "  Beleg fehlt Leistungsdatum " });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      text: "Beleg fehlt Leistungsdatum",
      erstelltVon: "nutzer:anna@example.org",
    });
    expect(
      (await post(steuer, `/api/dokumente/${d.id}/notizen`, { text: "Nachgefragt beim Lieferanten" })).status,
    ).toBe(201);
    expect((await notizen(d.id, steuer)).map((n) => n.text)).toEqual([
      "Beleg fehlt Leistungsdatum",
      "Nachgefragt beim Lieferanten",
    ]);
    expect((await post(pruefer, `/api/dokumente/${d.id}/notizen`, { text: "Prüfer" })).status).toBe(403);
    expect((await als(pruefer)(`/api/dokumente/${d.id}/notizen`)).status).toBe(403);
    expect((await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "   " })).status).toBe(400);
    // Die Ausnahme für die Steuerberatung gilt nur für Notizen
    expect(
      (await post(steuer, `/api/dokumente/${d.id}/einordnung`, { art: "frei", entstanden: "2024-01-01" })).status,
    ).toBe(403);
  });

  it("Tokens lesen mit lesen und schreiben mit schreiben", async () => {
    const d = await hoch("token.txt");
    const lesen = await tokenAnlegen(t, inhaber, "lesen");
    const schreiben = await tokenAnlegen(t, inhaber, "schreiben");
    const mit = (token: string, init: RequestInit = {}) =>
      t.anfrage(`/api/dokumente/${d.id}/notizen`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
    expect((await mit(lesen, { method: "POST", body: JSON.stringify({ text: "x" }) })).status).toBe(403);
    const neu = await mit(schreiben, { method: "POST", body: JSON.stringify({ text: "Vom Programm" }) });
    expect(neu.status).toBe(201);
    expect((await neu.json()).erstelltVon).toBe("token:schreiben");
    expect((await (await mit(lesen)).json()).map((n: { text: string }) => n.text)).toEqual(["Vom Programm"]);
  });

  it("lässt sich nur ergänzen: Ändern und Löschen lehnt Postgres ab, Zurückziehen blendet aus", async () => {
    const d = await hoch("anhang.txt");
    const n = await (await post(steuer, `/api/dokumente/${d.id}/notizen`, { text: "Tippfehler drin" })).json();
    await expect(t.sql`update notizen set text = 'anders' where id = ${n.id}`).rejects.toThrow("nur ergänzt");
    await expect(t.sql`delete from notizen where id = ${n.id}`).rejects.toThrow("nur ergänzt");
    // Zurückziehen darf, wer sie schrieb, und der Inhaber; nicht jemand anderes
    const fremd = await (await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "Vom Inhaber" })).json();
    expect((await post(steuer, `/api/dokumente/${d.id}/notizen/${fremd.id}/zurueckziehen`)).status).toBe(404);
    expect((await post(steuer, `/api/dokumente/${d.id}/notizen/${n.id}/zurueckziehen`)).status).toBe(200);
    expect((await post(steuer, `/api/dokumente/${d.id}/notizen/${n.id}/zurueckziehen`)).status).toBe(404);
    expect((await notizen(d.id)).map((x) => x.text)).toEqual(["Vom Inhaber"]);
    expect((await post(inhaber, `/api/dokumente/${d.id}/notizen/${fremd.id}/zurueckziehen`)).status).toBe(200);
    expect(await notizen(d.id)).toEqual([]);
    // Beides bleibt im Nachweis: im Audit-Log ohne Text, mit Hash; der Widerruf unveränderbar
    const log = await t.sql`select new_value from audit_log where table_name = 'notizen' and row_id = ${n.id}`;
    expect(log[0]!.new_value).not.toHaveProperty("text");
    expect(log[0]!.new_value.text_sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(t.sql`delete from notiz_widerrufe where notiz_id = ${n.id}`).rejects.toThrow("nur ergänzt");
    const verlauf = (await (await als(inhaber)(`/api/dokumente/${d.id}/verlauf`)).json()).ereignisse as {
      tabelle: string;
    }[];
    expect(verlauf.filter((e) => e.tabelle.startsWith("notiz")).map((e) => e.tabelle)).toEqual([
      "notizen",
      "notizen",
      "notiz_widerrufe",
      "notiz_widerrufe",
    ]);
    const prueferVerlauf = (await (await als(pruefer)(`/api/dokumente/${d.id}/verlauf`)).json()).ereignisse as {
      tabelle: string;
    }[];
    expect(prueferVerlauf.filter((e) => e.tabelle.startsWith("notiz"))).toEqual([]);
  });

  it("die Suche findet Notizen, aber nicht zurückgezogene und nicht für den Prüfer", async () => {
    const d = await hoch("suche.txt");
    await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "Rückfrage zur Zollanmeldung" });
    expect(await suche("Zollanmeldung")).toEqual([d.id]);
    expect(await suche("Zollanmeldung", steuer)).toEqual([d.id]);
    expect(await suche("Zollanmeldung", pruefer)).toEqual([]);
    const weg = await (await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "Kühlschrankquittung" })).json();
    expect(await suche("Kühlschrankquittung")).toEqual([d.id]);
    await post(inhaber, `/api/dokumente/${d.id}/notizen/${weg.id}/zurueckziehen`);
    expect(await suche("Kühlschrankquittung")).toEqual([]);
  });

  it("geht mit der Löschung des Dokuments, auch aus der Suche; danach kommt keine neue dazu", async () => {
    const d = await hoch("weg.txt");
    const n = await (
      await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "Vertraulicher Hinweis Gartenhaus" })
    ).json();
    await post(inhaber, `/api/dokumente/${d.id}/notizen/${n.id}/zurueckziehen`);
    await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "Zweiter Hinweis Gartenhaus" });
    expect(await suche("Gartenhaus")).toEqual([d.id]);
    expect((await post(inhaber, `/api/dokumente/${d.id}/loeschung`)).status).toBe(201);
    expect(await t.sql`select 1 from notizen where dokument_id = ${d.id}`).toHaveLength(0);
    expect(await t.sql`select 1 from notiz_widerrufe where notiz_id = ${n.id}`).toHaveLength(0);
    expect(await suche("Gartenhaus")).toEqual([]);
    const neu = await post(inhaber, `/api/dokumente/${d.id}/notizen`, { text: "Nach der Löschung" });
    expect(neu.status).toBe(409);
    // Im Audit-Log steht das Entfernen, ohne Text
    const entfernt = await t.sql`select old_value from audit_log where table_name = 'notizen' and action = 'DELETE'
                                   and old_value ->> 'dokument_id' = ${d.id}`;
    expect(entfernt).toHaveLength(2);
    expect(entfernt.every((e) => !("text" in e.old_value))).toBe(true);
    const befunde = await (await als(inhaber)("/api/pruefung")).json();
    expect(befunde.ok).toBe(true);
  });

  it("lässt keine Notiz nachkommen, die während der Löschung geschrieben wird", async () => {
    const d = await hoch("nebenlaeufig.txt");
    let abschliessen = () => {};
    let geschrieben = () => {};
    const istGeschrieben = new Promise<void>((r) => {
      geschrieben = r;
    });
    const schreiber = t.sql
      .begin(async (tx) => {
        await tx`insert into notizen (dokument_id, text, erstellt_von) values (${d.id}, 'gleichzeitig', 'x')`;
        geschrieben();
        await new Promise<void>((r) => {
          abschliessen = r;
        });
      })
      .catch((e: unknown) => e);
    await istGeschrieben;
    const loeschung = post(inhaber, `/api/dokumente/${d.id}/loeschung`);
    await new Promise((r) => setTimeout(r, 300));
    abschliessen();
    await schreiber;
    expect((await loeschung).status).toBe(201);
    expect(await t.sql`select 1 from notizen where dokument_id = ${d.id}`).toHaveLength(0);
  });
});
