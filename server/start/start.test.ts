import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { heute } from "../http/gemeinsam.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import type { Start } from "./start.ts";

const plusTage = (tag: string, tage: number) => {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!testDatenbankUrl)("Startseite gegen Postgres", { timeout: 30_000 }, () => {
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
  const start = async (cookie: string) => (await (await senden(cookie, "GET", "/api/start")).json()) as Start;
  const hochladen = async (name: string) => {
    const f = new FormData();
    f.append("datei", new File([new TextEncoder().encode(`Inhalt ${name}`)], name));
    return (await (await t.anfrage("/api/dokumente", { method: "POST", body: f }, inhaber)).json()) as {
      id: string;
    };
  };
  const einordnen = (id: string, eingabe: Record<string, unknown>) =>
    senden(inhaber, "POST", `/api/dokumente/${id}/einordnung`, eingabe);

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

  it("zählt Eingang, gesamt, dieses Jahr, Fristen, Anträge, Sperren und Speicher; Gelöschtes nicht", async () => {
    const offen = await hochladen("offen.txt");
    const bald = await hochladen("vertrag.txt");
    const spaet = await hochladen("spaeter.txt");
    const alt2024 = await hochladen("2024.txt");
    const weg = await hochladen("weg.txt");
    const tag = heute();
    await einordnen(bald.id, {
      art: "freiwillig",
      entstanden: "2024-03-01",
      freiwilligBis: plusTage(tag, 30),
      titel: "Vertrag",
    });
    await einordnen(spaet.id, { art: "freiwillig", entstanden: "2024-03-01", freiwilligBis: plusTage(tag, 200) });
    await einordnen(alt2024.id, { art: "beleg", entstanden: "2024-06-01" });
    await einordnen(weg.id, { art: "frei", entstanden: "2024-06-01" });
    // Frei Abgelegtes löscht dieselbe Person sofort
    expect((await senden(inhaber, "POST", `/api/dokumente/${weg.id}/loeschung`)).status).toBe(201);
    // Ein offener Antrag: freiwillig mit abgelaufener Frist braucht eine zweite Person
    const antrag = await hochladen("antrag.txt");
    await t.sql`insert into einordnungen (dokument_id, art, entstanden, frist_bis)
                values (${antrag.id}, 'freiwillig', '2020-01-01', '2021-01-01')`;
    expect((await senden(inhaber, "POST", `/api/dokumente/${antrag.id}/loeschung`)).status).toBe(201);
    await senden(inhaber, "POST", "/api/sperren", { grund: "Außenprüfung", von: "2024-01-01", bis: "2024-12-31" });

    const s = await start(inhaber);
    expect(s).toMatchObject({ eingang: 1, gesamt: 5, diesesJahr: 5, loeschantraege: 1 });
    expect(s.fristen!.anzahl).toBe(1);
    expect(s.fristen!.naechste).toEqual([
      expect.objectContaining({ id: bald.id, titel: "Vertrag", fristBis: plusTage(tag, 30) }),
    ]);
    // gesperrt: entstanden 2024 und eingeordnet (vertrag, spaeter, 2024)
    expect(s.sperren).toEqual({ aktiv: 1, dokumente: 3 });
    expect(s.speicher!.dateien).toBe(5);
    expect(s.speicher!.bytes).toBeGreaterThan(0);
    expect(s.quellen).toEqual({ postfaecher: [], ordner: null, paperless: null });
    expect(offen.id).toBeTruthy();
    // Die Steuerberatung sieht dieselben Zahlen
    // Der freie Platz des Datenträgers ändert sich zwischen zwei Abfragen; alles andere ist gleich
    const ohneFrei = (x: Start) => ({ ...x, speicher: { ...x.speicher, datentraeger: undefined } });
    expect(ohneFrei(await start(steuer))).toEqual(ohneFrei(s));
  });

  it("der Prüfer bekommt nur Zahlen seines Zeitraums, ohne Betrieb", async () => {
    const s = await start(pruefer);
    // Im Zeitraum 2024 liegen vertrag, spaeter, 2024 und der Antrag (2020) nicht; Eingang zählt nach Eingangstag
    expect(Object.keys(s).sort()).toEqual(["diesesJahr", "eingang", "gesamt", "verlauf", "vorjahr"]);
    expect(s).toEqual({
      eingang: 0,
      gesamt: 3,
      diesesJahr: 3,
      vorjahr: 0,
      verlauf: [...Array(11).fill(0), 3],
    });
  });

  it("Kacheln aus Ansichten je Zugang, nur sichtbare, im Audit-Log; gelöschte Ansichten verschwinden", async () => {
    const eigene = (await (
      await senden(inhaber, "POST", "/api/ansichten", { name: "Pflicht", parameter: { gruppe: "pflicht" } })
    ).json()) as { id: string };
    const geteilt = (await (
      await senden(inhaber, "POST", "/api/ansichten", { name: "Alle", parameter: {}, fuerAlle: true })
    ).json()) as { id: string };
    const fremd = (await (await senden(steuer, "POST", "/api/ansichten", { name: "STB", parameter: {} })).json()) as {
      id: string;
    };
    const setzen = (cookie: string, ansichten: string[]) => senden(cookie, "PUT", "/api/start/kacheln", { ansichten });
    expect((await setzen(inhaber, [geteilt.id, eigene.id])).status).toBe(200);
    expect(await (await senden(inhaber, "GET", "/api/start/kacheln")).json()).toEqual({
      ansichten: [geteilt.id, eigene.id],
    });
    expect((await setzen(inhaber, [fremd.id])).status).toBe(404);
    expect((await setzen(steuer, [geteilt.id, fremd.id])).status).toBe(200);
    expect((await setzen(pruefer, [geteilt.id])).status).toBe(404);
    expect((await setzen(pruefer, [])).status).toBe(200);
    // Reihenfolge ändern, dann die Ansicht löschen: die Kachel geht bei allen mit
    expect((await setzen(inhaber, [eigene.id, geteilt.id])).status).toBe(200);
    await senden(inhaber, "DELETE", `/api/ansichten/${geteilt.id}`);
    expect(await (await senden(steuer, "GET", "/api/start/kacheln")).json()).toEqual({ ansichten: [fremd.id] });
    const log = await t.sql<{ action: string; actor: string | null }[]>`
      select action, actor from audit_log where table_name = 'start_kacheln' order by seq`;
    expect(log.map((e) => e.action)).toEqual([
      "INSERT",
      "INSERT",
      "INSERT",
      "INSERT",
      "UPDATE",
      "UPDATE",
      "DELETE",
      "DELETE",
    ]);
    expect(log.slice(0, 5).every((e) => e.actor?.startsWith("nutzer:"))).toBe(true);
    const [kette] = await t.sql<{ n: number }[]>`select count(*)::int as n from belegt_integrity_problems(10)`;
    expect(kette!.n).toBe(0);
  });
});
