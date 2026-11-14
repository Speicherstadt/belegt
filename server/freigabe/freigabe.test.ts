import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zielAdresse } from "./freigabe.ts";

const OEFFNEN_MIT = { name: "Office im Browser", url: "https://office.example/oeffnen?datei={url}&name={name}" };

describe("Adresse für „Öffnen mit …“", () => {
  it("setzt Link und Dateinamen kodiert ein, auch mehrfach", () => {
    expect(
      zielAdresse("https://o.example/?a={url}&b={url}&n={name}", {
        url: "http://belegt/api/freigabe/x?y=1",
        name: "Angebot & Vertrag.docx",
      }),
    ).toBe(
      "https://o.example/?a=http%3A%2F%2Fbelegt%2Fapi%2Ffreigabe%2Fx%3Fy%3D1&b=http%3A%2F%2Fbelegt%2Fapi%2Ffreigabe%2Fx%3Fy%3D1&n=Angebot%20%26%20Vertrag.docx",
    );
  });
});

describe.skipIf(!testDatenbankUrl)("Öffnen mit einer anderen App gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  let pruefer: string;
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
  /** Den Link auf die Datei aus der Adresse der App */
  const linkAus = (url: string) => new URL(new URL(url).searchParams.get("datei")!).pathname;

  beforeAll(async () => {
    t = await testApp({ oeffnenMit: OEFFNEN_MIT });
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    kanzlei = await einladen({ rolle: "steuerberatung" }, "kanzlei@example.org");
    pruefer = await einladen({ rolle: "pruefer", zeitraum: { von: "2000-01-01", bis: "2100-12-31" } }, "p@example.org");
  });
  afterAll(() => t?.aufraeumen());

  it("nennt die App in /api/status und gibt ihr einen Link, über den sie das Original ohne Anmeldung holt", async () => {
    expect(await (await t.anfrage("/api/status")).json()).toMatchObject({ oeffnenMit: { name: "Office im Browser" } });
    const d = await hoch("Vertragstext", "Vertrag Müller.docx");
    const res = await als(inhaber)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" });
    expect(res.status).toBe(201);
    const { url, gueltigBis } = await res.json();
    expect(url).toMatch(/^https:\/\/office\.example\/oeffnen\?datei=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Ffreigabe%2F/);
    expect(new URL(url).searchParams.get("name")).toBe("Vertrag Müller.docx");
    expect(new Date(gueltigBis).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    const datei = await t.anfrage(linkAus(url));
    expect(datei.status).toBe(200);
    expect(await datei.text()).toBe("Vertragstext");
    expect(datei.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(datei.headers.get("access-control-allow-origin")).toBe("https://office.example");
    expect(datei.headers.get("cache-control")).toBe("no-store");
    // Der Link gilt nur für dieses Dokument, nicht für andere Schnittstellen
    const token = linkAus(url).split("/").pop()!;
    expect(
      (await t.anfrage(`/api/dokumente/${d.id}/datei`, { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(401);
    // Wer den Link anlegte, steht im Audit-Log, der Link selbst nicht
    const log = await t.sql`select actor, new_value::text as daten from audit_log where table_name = 'freigaben'`;
    expect(log).toHaveLength(1);
    expect(log[0]!.actor).toBe("nutzer:anna@example.org");
    expect(log[0]!.daten).not.toContain(token);
  });

  it("lehnt abgelaufene, falsche und verlängerte Links ab", async () => {
    const d = await hoch("x", "a.odt");
    const { url } = await (await als(inhaber)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" })).json();
    expect((await t.anfrage("/api/freigabe/falsch")).status).toBe(404);
    expect((await t.anfrage(`/api/freigabe/${"A".repeat(43)}`)).status).toBe(404);
    await expect(t.sql`update freigaben set gueltig_bis = now() + interval '1 year'`).rejects.toThrow();
    // Zeit vorspulen: der Link läuft nach zehn Minuten ab
    const vorher = Date.now;
    Date.now = () => vorher() - 11 * 60_000;
    const alt = await (await als(inhaber)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" })).json();
    Date.now = vorher;
    expect((await t.anfrage(linkAus(alt.url))).status).toBe(404);
    expect((await t.anfrage(linkAus(url))).status).toBe(200);
  });

  it("lässt die Steuerberatung eine Kopie öffnen, den Prüfer nicht, und nichts nach der Löschung", async () => {
    const d = await hoch("frei", "notiz.docx");
    expect((await als(kanzlei)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" })).status).toBe(201);
    expect((await als(pruefer)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" })).status).toBe(403);
    // Sonst bleibt die Steuerberatung beim Lesen
    expect(
      (await als(kanzlei)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-02" }))).status,
    ).toBe(403);

    const { url } = await (await als(inhaber)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" })).json();
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-01-02" }));
    expect((await als(inhaber)(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect((await t.anfrage(linkAus(url))).status).toBe(410);
    expect((await als(inhaber)(`/api/dokumente/${d.id}/freigabe`, { method: "POST" })).status).toBe(410);
  });

  it("gibt es ohne Einstellung nicht", async () => {
    const ohne = await testApp();
    try {
      const cookie = (await ohne.registrieren("b@example.org")).cookie;
      const f = new FormData();
      f.append("datei", new File(["x"], "x.docx"));
      const d = await (await ohne.anfrage("/api/dokumente", { method: "POST", body: f }, cookie)).json();
      expect((await ohne.anfrage(`/api/dokumente/${d.id}/freigabe`, { method: "POST" }, cookie)).status).toBe(404);
      expect((await (await ohne.anfrage("/api/status")).json()).oeffnenMit).toBeNull();
    } finally {
      await ohne.aufraeumen();
    }
  });
});
