import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entschluesseln, verschluesseln } from "../crypto.ts";
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

  const anfrageMit = (methode: string, pfad: string, body?: unknown, cookie = inhaber) =>
    als(cookie)(
      pfad,
      body === undefined
        ? { method: methode }
        : { method: methode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
  const chiffrat = async (id: string) =>
    ((await t.sql`select ciphertext from webhooks where id = ${id}`)[0] as { ciphertext: Buffer }).ciphertext;

  it("ändert Name, Adresse und Arten, das Geheimnis bleibt und erscheint nicht wieder", async () => {
    const { id, geheimnis } = await webhook("aendern", ["dokument.aufgenommen"]);
    const vorher = await chiffrat(id);
    const res = await anfrageMit("PATCH", `/api/webhooks/${id}`, {
      name: "geaendert",
      url: "https://neu.example/hook",
      arten: ["dokument.geloescht", "dokument.geloescht", "dokument.eingeordnet"],
    });
    expect(res.status).toBe(200);
    const w = await res.json();
    expect(w).toMatchObject({
      id,
      name: "geaendert",
      url: "https://neu.example/hook",
      arten: ["dokument.geloescht", "dokument.eingeordnet"],
    });
    expect(JSON.stringify(w)).not.toMatch(/ciphertext|geheimnis|whsec_/);
    expect((await chiffrat(id)).equals(vorher)).toBe(true);
    expect(entschluesseln(t.schluessel, await chiffrat(id)).toString()).toBe(geheimnis);
    // Auch nur ein Feld lässt sich ändern
    expect((await anfrageMit("PATCH", `/api/webhooks/${id}`, { name: "nur-name" })).status).toBe(200);
    const [e] = await t.sql`select actor, old_value, new_value from audit_log
      where table_name = 'webhooks' and action = 'UPDATE' and row_id = ${id} order by seq desc limit 1`;
    expect(e!.actor).toBe("nutzer:anna@example.org");
    expect(JSON.stringify(e)).not.toMatch(/ciphertext|whsec_/);
    await anfrageMit("POST", `/api/webhooks/${id}/deaktivieren`);
  });

  it("stellt nach dem Ändern der Adresse der neuen auch zu, was der alten noch fehlte, aber nichts doppelt", async () => {
    const { id } = await webhook("umzug", ["dokument.aufgenommen"]);
    await hochladen("umzug-1");
    expect((await zustellen(t.db, t.schluessel, empfaenger().senden)).umzug).toEqual({ zugestellt: 1, fehler: null });
    const zweites = await hochladen("umzug-2");
    expect((await anfrageMit("PATCH", `/api/webhooks/${id}`, { url: "https://neu.example/umzug" })).status).toBe(200);
    const neu = empfaenger();
    expect((await zustellen(t.db, t.schluessel, neu.senden)).umzug).toEqual({ zugestellt: 1, fehler: null });
    expect(neu.empfangen.map((e) => [e.url, JSON.parse(e.rumpf).dokumentId])).toEqual([
      ["https://neu.example/umzug", zweites.id],
    ]);
    await anfrageMit("POST", `/api/webhooks/${id}/deaktivieren`);
  });

  it("beendet einen Webhook still, der während der Zustellung entfernt wird", async () => {
    const { id } = await webhook("verschwindet", ["dokument.aufgenommen"]);
    await hochladen("verschwindet");
    const senden = async () => {
      expect((await anfrageMit("DELETE", `/api/webhooks/${id}`)).status).toBe(204);
      return new Response(null, { status: 200 });
    };
    expect((await zustellen(t.db, t.schluessel, senden)).verschwindet).toEqual({ zugestellt: 0, fehler: null });
  });

  it("lehnt Ändern mit unbekannter Nummer oder ungültiger Eingabe ab", async () => {
    const { id } = await webhook("ungueltig", ["dokument.aufgenommen"]);
    const unbekannt = "00000000-0000-4000-8000-000000000000";
    expect((await anfrageMit("PATCH", `/api/webhooks/${unbekannt}`, { name: "x" })).status).toBe(404);
    expect((await anfrageMit("PATCH", "/api/webhooks/keine-id", { name: "x" })).status).toBe(404);
    for (const body of [
      {},
      { url: "ftp://x.example/" },
      { arten: [] },
      { arten: ["unbekannt"] },
      { name: " " },
      { geheimnis: "whsec_selbst" },
    ])
      expect((await anfrageMit("PATCH", `/api/webhooks/${id}`, body)).status, JSON.stringify(body)).toBe(400);
    await anfrageMit("POST", `/api/webhooks/${id}/deaktivieren`);
  });

  it("entfernt einen Webhook ohne Zustellungen, ohne Chiffrat im Audit-Log", async () => {
    const { id } = await webhook("weg", ["dokument.geloescht"]);
    expect((await anfrageMit("DELETE", `/api/webhooks/${id}`)).status).toBe(204);
    expect(((await (await als(inhaber)("/api/webhooks")).json()) as { id: string }[]).some((w) => w.id === id)).toBe(
      false,
    );
    expect((await anfrageMit("DELETE", `/api/webhooks/${id}`)).status).toBe(404);
    expect((await anfrageMit("DELETE", "/api/webhooks/keine-id")).status).toBe(404);
    const [e] = await t.sql`select actor, old_value from audit_log
      where table_name = 'webhooks' and action = 'DELETE' and row_id = ${id}`;
    expect(e!.actor).toBe("nutzer:anna@example.org");
    expect(JSON.stringify(e)).not.toMatch(/ciphertext/);
  });

  it("entfernt keinen Webhook mit Zustellungen: 409, Deaktivieren statt Entfernen", async () => {
    const { id } = await webhook("zugestellt", ["dokument.aufgenommen"]);
    await hochladen("fuer-zugestellt");
    const r = empfaenger();
    expect((await zustellen(t.db, t.schluessel, r.senden)).zugestellt).toEqual({ zugestellt: 1, fehler: null });
    const res = await anfrageMit("DELETE", `/api/webhooks/${id}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { fehler: string }).fehler).toMatch(/Deaktivieren statt Entfernen/);
    expect(await t.sql`select 1 from webhooks where id = ${id}`).toHaveLength(1);
    expect((await anfrageMit("POST", `/api/webhooks/${id}/deaktivieren`)).status).toBe(200);
  });

  it("lässt Ändern und Entfernen nur den Inhaber mit Sitzung, nicht Steuerberatung oder Token", async () => {
    const { id } = await webhook("geschuetzt", ["dokument.geloescht"]);
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    const kanzlei = (
      await t.registrieren("kanzlei2@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    const { klartext } = await (await als(inhaber)("/api/tokens", json({ name: "t", recht: "schreiben" }))).json();
    const token = { headers: { authorization: `Bearer ${klartext}`, "content-type": "application/json" } };
    expect((await anfrageMit("PATCH", `/api/webhooks/${id}`, { name: "x" }, kanzlei)).status).toBe(403);
    expect((await anfrageMit("DELETE", `/api/webhooks/${id}`, undefined, kanzlei)).status).toBe(403);
    expect((await t.anfrage(`/api/webhooks/${id}`, { method: "PATCH", body: '{"name":"x"}', ...token })).status).toBe(
      403,
    );
    expect((await t.anfrage(`/api/webhooks/${id}`, { method: "DELETE", ...token })).status).toBe(403);
    expect(await t.sql`select 1 from webhooks where id = ${id} and name = 'geschuetzt'`).toHaveLength(1);
    await anfrageMit("POST", `/api/webhooks/${id}/deaktivieren`);
  });
});
