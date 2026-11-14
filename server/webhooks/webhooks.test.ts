import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verschluesseln } from "../crypto.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { signatur, zustellen } from "./webhooks.ts";

describe.skipIf(!testDatenbankUrl)("Webhooks gegen Postgres", () => {
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
  type Empfangen = { url: string; rumpf: string; kopf: Record<string, string> };
  const empfaenger = (antwort = 200) => {
    const empfangen: Empfangen[] = [];
    const senden = async (url: string, init: RequestInit) => {
      empfangen.push({ url, rumpf: String(init.body), kopf: init.headers as Record<string, string> });
      return new Response(null, { status: antwort });
    };
    return { empfangen, senden };
  };

  async function hochladen(inhalt: string) {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], `${inhalt}.pdf`));
    return (await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json()) as { id: string };
  }

  async function webhook(name: string, arten: string[]) {
    const res = await als(inhaber)("/api/webhooks", json({ name, url: `https://empfang.example/${name}`, arten }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; geheimnis: string };
  }

  let vorher: { id: string };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    vorher = await hochladen("vor-dem-webhook");
  });
  afterAll(() => t?.aufraeumen());

  it("legt einen Webhook an, das Geheimnis gibt es einmal und nicht im Audit-Log", async () => {
    const { geheimnis } = await webhook("liste", ["dokument.geloescht"]);
    expect(geheimnis).toMatch(/^whsec_/);
    const liste = await (await als(inhaber)("/api/webhooks")).json();
    expect(JSON.stringify(liste)).not.toContain(geheimnis);
    expect(JSON.stringify(liste)).not.toContain("ciphertext");
    expect(JSON.stringify(await t.sql`select new_value from audit_log where table_name = 'webhooks'`)).not.toContain(
      "ciphertext",
    );
    expect(
      (await als(inhaber)("/api/webhooks", json({ name: "x", url: "ftp://x.example/", arten: ["dokument.geloescht"] })))
        .status,
    ).toBe(400);
    expect(
      (await als(inhaber)("/api/webhooks", json({ name: "x", url: "https://x.example/", arten: [] }))).status,
    ).toBe(400);
  });

  it("meldet Aufnahme und Einordnung der Reihe nach, signiert, und jedes Ereignis einmal", async () => {
    const { id, geheimnis } = await webhook("alles", ["dokument.aufgenommen", "dokument.eingeordnet"]);
    const d = await hochladen("nach-dem-webhook");
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "beleg", entstanden: "2026-05-01" }));

    const { empfangen, senden } = empfaenger();
    const ergebnis = await zustellen(t.db, t.schluessel, senden);
    expect(ergebnis.alles).toEqual({ zugestellt: 2, fehler: null });
    const nurDieser = empfangen.filter((e) => e.url.endsWith("/alles"));
    expect(nurDieser.map((e) => JSON.parse(e.rumpf))).toEqual([
      expect.objectContaining({ art: "dokument.aufgenommen", dokumentId: d.id }),
      expect.objectContaining({ art: "dokument.eingeordnet", dokumentId: d.id }),
    ]);
    for (const e of nurDieser) expect(e.kopf["x-belegt-signatur"]).toBe(signatur(geheimnis, e.rumpf));
    // Was vor dem Anlegen geschah, meldet der Webhook nicht
    expect(nurDieser.some((e) => e.rumpf.includes(vorher.id))).toBe(false);

    const zweiter = empfaenger();
    expect((await zustellen(t.db, t.schluessel, zweiter.senden)).alles).toEqual({ zugestellt: 0, fehler: null });
    await als(inhaber)(`/api/webhooks/${id}/deaktivieren`, { method: "POST" });
  });

  it("hält bei einem Fehler an und stellt beim nächsten Lauf dasselbe Ereignis zu", async () => {
    const { id } = await webhook("wackelig", ["dokument.aufgenommen"]);
    const d = await hochladen("wackelig");
    const kaputt = empfaenger(500);
    expect((await zustellen(t.db, t.schluessel, kaputt.senden)).wackelig).toEqual({
      zugestellt: 0,
      fehler: "Antwort 500",
    });
    const [w] = await t.sql`select letzter_fehler from webhooks where id = ${id}`;
    expect(w!.letzter_fehler).toBe("Antwort 500");

    const heil = empfaenger();
    expect((await zustellen(t.db, t.schluessel, heil.senden)).wackelig).toEqual({ zugestellt: 1, fehler: null });
    expect(JSON.parse(heil.empfangen.find((e) => e.url.endsWith("/wackelig"))!.rumpf).dokumentId).toBe(d.id);
    await als(inhaber)(`/api/webhooks/${id}/deaktivieren`, { method: "POST" });
  });

  it("meldet nur die gewählten Arten und nichts, solange er deaktiviert ist", async () => {
    const { id } = await webhook("aus", ["dokument.aufgenommen"]);
    await als(inhaber)(`/api/webhooks/${id}/deaktivieren`, { method: "POST" });
    await hochladen("waehrend-aus");
    const r = empfaenger();
    const ergebnis = await zustellen(t.db, t.schluessel, r.senden);
    expect(ergebnis.aus).toBeUndefined();
    expect(ergebnis.liste).toEqual({ zugestellt: 0, fehler: null });
  });

  it("stellt den übrigen Webhooks zu, wenn sich ein Geheimnis nicht entschlüsseln lässt", async () => {
    // Etwa nach einem Wechsel von BELEGT_SCHLUESSEL: dieses Geheimnis ist mit einem anderen Schlüssel verschlüsselt
    const [kaputt] = await t.sql<{ id: string }[]>`
      insert into webhooks (name, url, arten, ciphertext)
      values ('fremder-schluessel', 'https://empfang.example/fremd', ${["dokument.aufgenommen"]},
              ${verschluesseln(randomBytes(32), Buffer.from("whsec_x"))})
      returning id`;
    const { id } = await webhook("heil", ["dokument.aufgenommen"]);
    try {
      await hochladen("trotz-kaputtem-webhook");
      const r = empfaenger();
      const ergebnis = await zustellen(t.db, t.schluessel, r.senden);
      expect(ergebnis.heil).toEqual({ zugestellt: 1, fehler: null });
      expect(ergebnis["fremder-schluessel"]).toEqual({
        zugestellt: 0,
        fehler: expect.stringMatching(/entschlüsseln/),
      });
      const [w] = await t.sql`select letzter_fehler from webhooks where id = ${kaputt!.id}`;
      expect(w!.letzter_fehler).toMatch(/entschlüsseln/);
    } finally {
      await t.sql`update webhooks set aktiv = false where id in (${kaputt!.id}, ${id})`;
    }
  });

  it("hält die Ereignisse in Postgres fest: nur anhängen", async () => {
    await expect(t.sql`update webhook_ereignisse set art = 'x'`).rejects.toThrow(/nur anhängen/);
    await expect(t.sql`delete from webhook_ereignisse`).rejects.toThrow(/nur anhängen/);
  });

  it("lässt nur den Inhaber Webhooks sehen und anlegen", async () => {
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    const kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    expect((await als(kanzlei)("/api/webhooks")).status).toBe(403);
    expect(
      (
        await als(kanzlei)(
          "/api/webhooks",
          json({ name: "x", url: "https://x.example/", arten: ["dokument.geloescht"] }),
        )
      ).status,
    ).toBe(403);
  });
});
