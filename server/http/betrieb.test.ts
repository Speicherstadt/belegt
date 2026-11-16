import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { verfahrensdoku } from "../verfahrensdoku/verfahrensdoku.ts";

/*
 * GET /api/betrieb gegen Postgres. Die Testdatenbank gehört dem Superuser der Tests: Die Anzeige muss genau das als
 * „mehr Rechte als nötig“ melden. Die eingeschränkte App-Rolle prüft server/db/rollen.test.ts.
 */
describe.skipIf(!testDatenbankUrl)("Betrieb: GET /api/betrieb", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let steuer: string;
  let pruefer: string;

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

  it("zeigt die wirksamen Rechte der Anmeldung und warnt bei Superuser", async () => {
    const res = await t.anfrage("/api/betrieb", {}, inhaber);
    expect(res.status).toBe(200);
    const { datenbank } = await res.json();
    expect(datenbank.eingeschraenkt).toBe(false);
    expect(datenbank.probleme).toContain("admin");
    expect(datenbank.tabellen).toContainEqual(expect.objectContaining({ tabelle: "audit_log", select: true }));
    // Keine Verbindungsadresse, kein Passwort
    expect(JSON.stringify(datenbank)).not.toMatch(/postgres:\/\//);
  });

  const eintragen = (art: string, ok: boolean, meldung: string, vorStunden: number) =>
    t.sql.begin(async (tx) => {
      await tx`select set_config('belegt.actor', 'backup', true)`;
      await tx`insert into backup_status (art, ok, snapshot, bytes, meldung, ziel, zeitplan, am)
        values (${art}, ${ok}, 'abcd1234', 2048, ${meldung}, 's3:s3.example/bucket/belegt',
                'täglich um 03:15, Test-Restore alle 7 Tage', now() - ${vorStunden} * interval '1 hour')`;
    });
  const backup = async () => (await (await t.anfrage("/api/betrieb", {}, inhaber)).json()).backup;

  it("meldet ohne Eintrag des Backup-Containers keins", async () => {
    expect(await backup()).toMatchObject({ zustand: "keins", ueberfaellig: false, letztesBackup: null });
  });

  it("zeigt letztes Backup und letzten Test-Restore", async () => {
    await eintragen("backup", true, "Datenbank und 3 Dateien", 30);
    await eintragen("restore_check", true, "3 Dokumente … geprüft", 29);
    const b = await backup();
    expect(b.zustand).toBe("ok");
    expect(b.letztesBackup).toMatchObject({
      ok: true,
      snapshot: "abcd1234",
      bytes: 2048,
      ziel: "s3:s3.example/bucket/belegt",
    });
    expect(b.letzterTest.meldung).toBe("3 Dokumente … geprüft");
    const doku = await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" });
    const betrieb = doku.abschnitte.find((a) => a.titel.startsWith("7."))!.absaetze.join("\n");
    expect(betrieb).toContain("nach s3:s3.example/bucket/belegt, täglich um 03:15, Test-Restore alle 7 Tage");
    expect(betrieb).toContain("Zuletzt bestanden am");
  });

  it("meldet einen fehlgeschlagenen Test-Restore als Fehler, mit Meldung, auch in der Verfahrensdoku", async () => {
    await eintragen("restore_check", false, "1 Befunde: dokumente x: Datei fehlt", 1);
    const b = await backup();
    expect(b.zustand).toBe("fehler");
    expect(b.fehlgeschlagen).toEqual([
      { art: "restore_check", lauf: expect.objectContaining({ meldung: "1 Befunde: dokumente x: Datei fehlt" }) },
    ]);
    // Der letzte bestandene Test bleibt sichtbar
    expect(b.letzterTest.meldung).toBe("3 Dokumente … geprüft");
    const doku = await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" });
    expect(doku.abschnitte.find((a) => a.titel.startsWith("7."))!.absaetze.join("\n")).toContain(
      "Der letzte Test-Restore am",
    );
  });

  it("meldet ein Backup, das älter als zwei Tage ist, als überfällig", async () => {
    await eintragen("restore_check", true, "wieder gut", 0);
    expect(await backup()).toMatchObject({ zustand: "ok", ueberfaellig: false });
    const { backupStand } = await import("../betrieb/backup.ts");
    const spaeter = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    expect(await backupStand(t.db, spaeter)).toMatchObject({ zustand: "veraltet", ueberfaellig: true });
  });

  it("darf die Steuerberatung lesen, der Prüfer nicht", async () => {
    expect((await t.anfrage("/api/betrieb", {}, steuer)).status).toBe(200);
    expect((await t.anfrage("/api/betrieb", {}, pruefer)).status).toBe(403);
  });
});
