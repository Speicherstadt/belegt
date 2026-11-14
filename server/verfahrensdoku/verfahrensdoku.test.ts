import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Einstellungen und Verfahrensdokumentation gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const angaben = {
    firma: "Muster & Söhne GmbH",
    anschrift: "Musterweg 1, 12345 Musterstadt",
    verantwortlich: "Anna Muster",
    aufsicht: false,
    datensicherung: "Täglich verschlüsselt auf ein zweites Gerät, monatlich Wiederherstellung geprüft.",
    scannen: "Es wird nicht gescannt.",
    ergaenzungen: "",
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("nennt ohne Angaben die Lücken, statt sie zu füllen", async () => {
    const doku = await (await als(inhaber)("/api/verfahrensdoku")).json();
    expect(doku.vollstaendig).toBe(false);
    const luecken = doku.abschnitte.flatMap((a: { luecken?: string[] }) => a.luecken ?? []);
    expect(luecken).toEqual(
      expect.arrayContaining([
        "Name des Betriebs",
        "verantwortliche Person",
        expect.stringMatching(/^Beschreibung der Datensicherung/),
      ]),
    );
    expect(JSON.stringify(doku)).toContain("Buchungsbelege werden acht Jahre aufbewahrt");
    expect(JSON.stringify(doku)).toContain("im Dateisystem des Servers");
  });

  it("speichert Angaben nur durch den Inhaber, mit Eintrag im Audit-Log", async () => {
    expect((await als(kanzlei)("/api/einstellungen", json(angaben))).status).toBe(403);
    expect((await als(inhaber)("/api/einstellungen", json({ ...angaben, firma: "x".repeat(301) }))).status).toBe(400);
    const res = await als(inhaber)("/api/einstellungen", json(angaben));
    expect(res.status).toBe(200);
    expect(await (await als(kanzlei)("/api/einstellungen")).json()).toMatchObject(angaben);
    const [eintrag] = await t.sql`
      select actor, action from audit_log where table_name = 'einstellungen' order by seq desc limit 1`;
    expect(eintrag).toEqual({ actor: "nutzer:anna@example.org", action: "UPDATE" });
  });

  it("beschreibt Betrieb, Regeln und Zugänge und ist mit allen Angaben vollständig", async () => {
    await als(inhaber)("/api/regeln", json({ name: "Telefon", wenn: { domain: "telefon.example" }, dann: "beleg" }));
    const doku = await (await als(kanzlei)("/api/verfahrensdoku")).json();
    expect(doku.vollstaendig).toBe(true);
    const text = JSON.stringify(doku);
    expect(text).toContain("Muster & Söhne GmbH archiviert");
    expect(text).toContain("Verantwortlich für das Archiv: Anna Muster");
    expect(text).toContain("Täglich verschlüsselt");
    expect(text).toContain("Regel „Telefon“ schlägt vor: Buchungsbelege");
    expect(text).toContain("kanzlei@example.org: Steuerberatung");
    expect(doku.stand).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("nennt im Zugriff die API-Tokens, die schreiben oder lesen, ohne ihr Geheimnis", async () => {
    const anlegen = async (name: string, recht: string) =>
      (await (await als(inhaber)("/api/tokens", json({ name, recht }))).json()) as { id: string; klartext: string };
    const kasse = await anlegen("Kasse", "schreiben");
    const bi = await anlegen("Auswertung", "lesen");
    const alt = await anlegen("Altes Skript", "schreiben");
    await als(inhaber)(`/api/tokens/${alt.id}/widerrufen`, { method: "POST" });
    const doku = await (await als(kanzlei)("/api/verfahrensdoku")).json();
    const zugriff = doku.abschnitte.find((a: { titel: string }) => a.titel === "6. Zugriff");
    const text = JSON.stringify(zugriff);
    expect(text).toContain("API-Token „Kasse“: liest, nimmt auf und ordnet ein");
    expect(text).toContain("API-Token „Auswertung“: liest");
    expect(text).not.toContain("Altes Skript");
    expect(text).not.toMatch(/Nur der Inhaber schreibt;/);
    for (const t of [kasse, bi]) expect(JSON.stringify(doku)).not.toContain(t.klartext);
  });

  it("rechnet für ein Institut unter Aufsicht zehn Jahre für Buchungsbelege", async () => {
    await als(inhaber)("/api/einstellungen", json({ ...angaben, aufsicht: true }));
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode("%PDF-1.7\n% Bankbeleg\n")], "bank.pdf"));
    const d = await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json();
    const e = await (
      await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "beleg", entstanden: "2026-03-01" }))
    ).json();
    expect(e.fristBis).toBe("2036-12-31");
    expect(JSON.stringify(await (await als(inhaber)("/api/verfahrensdoku")).json())).toContain(
      "Buchungsbelege werden deshalb zehn Jahre aufbewahrt",
    );
    await als(inhaber)("/api/einstellungen", json(angaben));
  });

  it("nennt den Betrieb als Datenlieferant im Z3-Export", async () => {
    const res = await als(inhaber)("/api/export?von=2026-01-01&bis=2026-12-31");
    const index = new TextDecoder().decode(unzipSync(new Uint8Array(await res.arrayBuffer()))["index.xml"]);
    expect(index).toContain("<Name>Muster &amp; Söhne GmbH</Name>");
    expect(index).toContain("<Location>Musterweg 1, 12345 Musterstadt</Location>");
  });
});
