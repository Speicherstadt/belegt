import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenDarf } from "./tokens.ts";

describe("Rechte eines Tokens", () => {
  it("lässt lesen nur Dokumente lesen und schreiben zusätzlich aufnehmen und einordnen", () => {
    expect(tokenDarf("lesen", "GET", "/api/dokumente/abc/datei")).toBe(true);
    expect(tokenDarf("lesen", "GET", "/api/dokumente/abc/ansicht")).toBe(true);
    expect(tokenDarf("lesen", "POST", "/api/dokumente")).toBe(false);
    expect(tokenDarf("schreiben", "POST", "/api/dokumente")).toBe(true);
    expect(tokenDarf("schreiben", "POST", "/api/dokumente/abc/einordnung")).toBe(true);
    for (const [m, p] of [
      ["POST", "/api/dokumente/abc/loeschung"],
      ["POST", "/api/loeschungen/abc/bestaetigen"],
      ["GET", "/api/tokens"],
      ["POST", "/api/tokens"],
      ["POST", "/api/einladungen"],
      ["POST", "/api/einstellungen"],
      ["GET", "/api/quellen"],
    ] as const)
      expect(tokenDarf("schreiben", m, p)).toBe(false);
  });
});

describe.skipIf(!testDatenbankUrl)("API-Tokens gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const mitToken = (token: string, pfad: string, init: RequestInit = {}) =>
    t.app.request(pfad, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });

  async function token(name: string, recht: "lesen" | "schreiben") {
    const res = await als(inhaber)("/api/tokens", json({ name, recht }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; klartext: string };
  }

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("speichert nur den Hash und zeigt den Klartext einmal", async () => {
    const { klartext } = await token("Buchhaltung", "lesen");
    expect(klartext).toMatch(/^belegt_[A-Za-z0-9_-]{43}$/);
    const liste = await (await als(inhaber)("/api/tokens")).json();
    expect(JSON.stringify(liste)).not.toContain(klartext);
    expect(liste[0]).toMatchObject({ name: "Buchhaltung", recht: "lesen", widerrufenAm: null });
    expect(JSON.stringify(await t.sql`select new_value from audit_log where table_name = 'api_tokens'`)).not.toContain(
      "token_hash",
    );
  });

  it("nimmt mit einem schreibenden Token auf und ordnet ein, mit dem Token als Akteur", async () => {
    const { klartext } = await token("Scanner", "schreiben");
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode("%PDF-1.7\n% gescannt\n")], "scan.pdf"));
    const res = await mitToken(klartext, "/api/dokumente", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const d = await res.json();
    const e = await mitToken(klartext, `/api/dokumente/${d.id}/einordnung`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ art: "beleg", entstanden: "2026-05-01" }),
    });
    expect(e.status).toBe(201);
    const [eintrag] = await t.sql`select actor from audit_log where table_name = 'dokumente' and row_id = ${d.id}`;
    expect(eintrag!.actor).toBe("token:Scanner");
    // Löschen, verwalten und Tokens anlegen kann kein Token, auch ein schreibendes nicht
    expect((await mitToken(klartext, `/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(403);
    expect((await mitToken(klartext, "/api/tokens", json({ name: "x", recht: "schreiben" }))).status).toBe(403);
    expect((await mitToken(klartext, "/api/zugaenge")).status).toBe(403);
  });

  it("lässt ein lesendes Token nur lesen und lehnt widerrufene und falsche Tokens ab", async () => {
    const { id, klartext } = await token("Auswertung", "lesen");
    expect((await mitToken(klartext, "/api/dokumente")).status).toBe(200);
    const form = new FormData();
    form.append("datei", new File(["x"], "x.txt"));
    expect((await mitToken(klartext, "/api/dokumente", { method: "POST", body: form })).status).toBe(403);
    expect((await als(inhaber)(`/api/tokens/${id}/widerrufen`, { method: "POST" })).status).toBe(200);
    expect((await mitToken(klartext, "/api/dokumente")).status).toBe(401);
    expect((await mitToken("belegt_falsch", "/api/dokumente")).status).toBe(401);
    expect((await mitToken("kein-token", "/api/dokumente")).status).toBe(401);
  });

  it("lässt nur den Inhaber Tokens verwalten", async () => {
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    const kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    expect((await als(kanzlei)("/api/tokens")).status).toBe(403);
    expect((await als(kanzlei)("/api/tokens", json({ name: "x", recht: "lesen" }))).status).toBe(403);
    expect((await als(inhaber)("/api/tokens", json({ name: " ", recht: "lesen" }))).status).toBe(400);
  });
});
