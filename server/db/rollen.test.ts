import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatenbank, testDatenbankUrl } from "../test-db.ts";
import { datenbankVorbereiten, migrierenMitRechten } from "./migrieren.ts";
import { zugriffLesen, zugriffWarnung } from "./rollen.ts";

/*
 * Getrennte Datenbankrollen gegen Postgres: Die App-Rolle legt der Test selbst an (eigener Name je Prozess) und entfernt
 * sie am Ende. Alles, was die Unveränderbarkeit an den Triggern vorbei aufheben könnte, muss als App-Rolle scheitern.
 */
describe.skipIf(!testDatenbankUrl)("Getrennte Datenbankrollen (Postgres)", () => {
  const appRolle = `belegt_rollentest_${process.pid}`;
  const passwort = "rollen-test-passwort";
  let admin: postgres.Sql;
  let app: postgres.Sql;
  let appUrl: string;

  beforeAll(async () => {
    admin = await testDatenbank();
    await admin`drop role if exists ${admin(appRolle)}`.catch(() => {});
    await admin.unsafe(
      `create role "${appRolle}" login password '${passwort}' nosuperuser nocreatedb nocreaterole noinherit`,
    );
    const u = new URL(testDatenbankUrl!);
    u.username = appRolle;
    u.password = passwort;
    appUrl = u.toString();
    await migrierenMitRechten(testDatenbankUrl!, appUrl);
    app = postgres(appUrl, { max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    if (!admin) return;
    await admin`drop owned by ${admin(appRolle)}`;
    await admin.end();
    // Die Rolle hat Rechte nur in dieser Datenbank; die Verbindung zur Datenbank des Workers ist zu
    const u = new URL(testDatenbankUrl!);
    u.pathname = "/postgres";
    const p = postgres(u.toString(), { max: 1, onnotice: () => {} });
    await p.unsafe(`drop role if exists "${appRolle}"`);
    await p.end();
  });

  /** Führt sql als App-Rolle in einer Transaktion aus, die immer zurückgerollt wird, und gibt den Fehler zurück */
  async function alsApp(befehl: string): Promise<string | null> {
    try {
      await app.begin(async (tx) => {
        await tx`select set_config('belegt.actor', 'test:rollen', true)`;
        await tx.unsafe(befehl);
        throw new Error("__zurueck__");
      });
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err);
      return meldung === "__zurueck__" ? null : meldung;
    }
    return null;
  }

  const sha = "a".repeat(64);
  const dokumentAnlegen = `insert into dokumente (sha256, groesse, mime_type, dateiname, quelle)
    values ('${sha}', 1, 'application/pdf', 'rolle.pdf', 'upload')`;

  it("meldet die App-Anmeldung als eingeschränkt, ohne Warnung", async () => {
    const z = await zugriffLesen(app);
    expect(z).toMatchObject({ rolle: appRolle, anmeldung: appRolle, eingeschraenkt: true, probleme: [] });
    expect(zugriffWarnung(z)).toBeNull();
  });

  it.each([
    ["einen Trigger abschalten", "alter table dokumente disable trigger dokumente_append_only"],
    ["alle Trigger abschalten", "alter table audit_log disable trigger all"],
    ["einen Trigger entfernen", "drop trigger seals_append_only on seals"],
    ["den Replikationsmodus setzen", "set session_replication_role = replica"],
    ["den Replikationsmodus lokal setzen", "set local session_replication_role = replica"],
    ["eine versiegelte Zeile ändern", "update dokumente set dateiname = 'geaendert'"],
    ["eine versiegelte Zeile löschen", "delete from dokumente"],
    ["das Audit-Log ändern", "update audit_log set actor = 'jemand'"],
    ["das Audit-Log leeren", "truncate audit_log"],
    ["Siegel löschen", "delete from seals"],
    ["eine Tabelle leeren", "truncate einstellungen"],
    ["den Kopf der Kette zurücksetzen", "update audit_chain set seq = 0"],
    // Die Kette beweist nur Reihenfolge und Vollständigkeit; ein erfundener Eintrag wäre ein gültiges Glied
    [
      "einen Eintrag im Audit-Log erfinden",
      "insert into audit_log (actor, table_name, row_id, action, old_value) values ('user:inhaber', 'dokumente', 'x', 'DELETE', '{}')",
    ],
    [
      "ein Siegel erfinden",
      "insert into seals (table_name, row_id, columns, digest) values ('einstellungen', gen_random_uuid(), '{}', 'x')",
    ],
    ["eine Tabelle versiegelt anmelden", "insert into sealed_tables (table_name) values ('einstellungen')"],
    ["eine Tabelle über die Funktion anmelden", "select belegt_seal_table('einstellungen')"],
    ["eine Tabelle anlegen", "create table fremd (x int)"],
    ["eine temporäre Tabelle anlegen", "create temp table audit_log (x int)"],
    ["eine Spalte ändern", "alter table dokumente add column x int"],
    [
      "eine Funktion ersetzen",
      "create or replace function belegt_append_only() returns trigger language plpgsql as 'begin return new; end'",
    ],
    ["die Migrationen ändern", "delete from drizzle.__drizzle_migrations"],
    ["den Stand der Sicherung fälschen", "insert into backup_status (art, ok) values ('backup', true)"],
    ["die Rolle wechseln", "set role postgres"],
  ])("verbietet der App-Rolle: %s", async (_was, befehl) => {
    expect(await alsApp(befehl)).not.toBeNull();
  });

  it("erlaubt der App-Rolle, Dokumente aufzunehmen; Siegel und Kette entstehen dabei", async () => {
    expect(
      await alsApp(`${dokumentAnlegen}; set constraints all immediate;
        do $$ begin
          if not exists (select 1 from seals where table_name = 'dokumente') then raise exception 'kein Siegel'; end if;
          if exists (select 1 from belegt_integrity_problems(1)) then raise exception 'Kette beschädigt'; end if;
        end $$`),
    ).toBeNull();
  });

  it("erlaubt der App-Rolle, ungesperrte Tabellen zu ändern und zu löschen", async () => {
    expect(await alsApp("update einstellungen set firma = firma")).toBeNull();
    expect(await alsApp("delete from webhook_zustellungen")).toBeNull();
    expect(await alsApp("select count(*) from audit_log")).toBeNull();
  });

  it("zeigt die wirksamen Rechte je Tabellenart", async () => {
    const { tabellen } = await zugriffLesen(app);
    const t = (name: string) => tabellen.find((x) => x.tabelle === name);
    const nurErgaenzen = { select: true, insert: true, update: false, delete: false, truncate: false, trigger: false };
    const nurLesen = { select: true, insert: false, update: false, delete: false };
    expect(t("audit_log")).toMatchObject(nurLesen);
    expect(t("seals")).toMatchObject(nurLesen);
    expect(t("dokumente")).toMatchObject(nurErgaenzen);
    expect(t("freigaben")).toMatchObject(nurErgaenzen);
    expect(t("audit_chain")).toMatchObject(nurLesen);
    expect(t("sealed_tables")).toMatchObject(nurLesen);
    expect(t("backup_status")).toMatchObject(nurLesen);
    // Festschreibung über eine Spalte: ändern, solange nicht festgeschrieben, prüft der Trigger
    expect(t("loeschungen")).toMatchObject({ select: true, insert: true, update: true, delete: true });
    expect(t("einstellungen")).toMatchObject({ select: true, insert: true, update: true, delete: true });
    expect(tabellen.every((x) => !x.truncate && !x.trigger)).toBe(true);
  });

  it("vergibt die Rechte idempotent: ein zweiter Lauf ändert nichts", async () => {
    const vorher = await admin`select table_name, privilege_type from information_schema.role_table_grants
      where grantee = ${appRolle} order by 1, 2`;
    await migrierenMitRechten(testDatenbankUrl!, appUrl);
    const nachher = await admin`select table_name, privilege_type from information_schema.role_table_grants
      where grantee = ${appRolle} order by 1, 2`;
    expect(nachher).toEqual(vorher);
    expect(vorher.length).toBeGreaterThan(0);
  });

  it("nimmt der App-Rolle zu viel vergebene Rechte beim nächsten Lauf wieder", async () => {
    await admin.unsafe(`grant update, delete, truncate on audit_log, dokumente to "${appRolle}"`);
    await migrierenMitRechten(testDatenbankUrl!, appUrl);
    expect(await alsApp("truncate audit_log")).not.toBeNull();
    const { tabellen } = await zugriffLesen(app);
    expect(tabellen.find((x) => x.tabelle === "dokumente")).toMatchObject({ update: false, delete: false });
  });

  it("startet ohne MIGRATION_DATABASE_URL mit eingeschränkter Anmeldung, wenn alle Migrationen angewendet sind", async () => {
    const z = await datenbankVorbereiten({ appUrl });
    expect(z.eingeschraenkt).toBe(true);
  });

  it("startet nicht, wenn eine Migration fehlt und nur die App-Anmeldung da ist", async () => {
    const ordner = mkdtempSync(join(tmpdir(), "belegt-rollen-"));
    mkdirSync(join(ordner, "meta"));
    writeFileSync(
      join(ordner, "meta", "_journal.json"),
      JSON.stringify({ entries: [{ idx: 0, version: "7", when: 9_000_000_000_000, tag: "9999_zukunft" }] }),
    );
    await expect(datenbankVorbereiten({ appUrl }, ordner)).rejects.toThrow(/MIGRATION_DATABASE_URL/);
  });

  it("läuft mit nur der Eigentümer-Anmeldung weiter wie bisher, mit Warnung", async () => {
    const z = await datenbankVorbereiten({ appUrl: testDatenbankUrl! });
    expect(z.eingeschraenkt).toBe(false);
    expect(zugriffWarnung(z)).toMatch(/mehr Rechte als nötig/);
    expect(zugriffWarnung(z)).not.toContain(passwort);
  });

  it("lehnt dieselbe Anmeldung für App und Migration ab", async () => {
    await expect(migrierenMitRechten(testDatenbankUrl!, testDatenbankUrl!)).rejects.toThrow(/verschiedene/);
  });

  it("lehnt eine App-Rolle mit der Vorgabe session_replication_role = replica ab", async () => {
    await admin.unsafe(`alter role "${appRolle}" set session_replication_role = replica`);
    try {
      await expect(migrierenMitRechten(testDatenbankUrl!, appUrl)).rejects.toThrow(/replica/);
    } finally {
      await admin.unsafe(`alter role "${appRolle}" reset session_replication_role`);
    }
  });

  // pg_write_all_data gibt INSERT, UPDATE und DELETE auf jede Tabelle, auch auf backup_status und sealed_tables
  // (https://www.postgresql.org/docs/16/predefined-roles.html); geerbt oder per SET ROLE erreichbar
  it.each([
    ["geerbt", "with inherit true, set false"],
    ["per SET ROLE", "with inherit false, set true"],
  ])("lehnt eine App-Rolle mit pg_write_all_data (%s) ab", async (_wie, option) => {
    await admin.unsafe(`grant pg_write_all_data to "${appRolle}" ${option}`);
    try {
      await expect(migrierenMitRechten(testDatenbankUrl!, appUrl)).rejects.toThrow(/nicht eingeschränkt/);
    } finally {
      await admin.unsafe(`revoke pg_write_all_data from "${appRolle}"`);
    }
  });

  it("lehnt eine App-Rolle ab, die über PUBLIC den Stand der Sicherung schreiben darf", async () => {
    await admin.unsafe("grant insert on backup_status to public");
    try {
      await expect(migrierenMitRechten(testDatenbankUrl!, appUrl)).rejects.toThrow(/nicht eingeschränkt/);
    } finally {
      await admin.unsafe("revoke insert on backup_status from public");
    }
  });

  // lo_create darf jede Rolle; ein eigenes Large Object gibt keine Macht über Tabellen oder Trigger
  it("startet weiter, wenn die App-Rolle ein Large Object angelegt hat", async () => {
    const [lo] = await app<{ oid: number }[]>`select lo_create(0) as oid`;
    try {
      await expect(migrierenMitRechten(testDatenbankUrl!, appUrl)).resolves.toMatchObject({ eingeschraenkt: true });
    } finally {
      await admin`select lo_unlink(${lo!.oid})`;
    }
  });

  it("lehnt eine App-Rolle mit Rechten zum Anlegen von Rollen ab", async () => {
    await admin.unsafe(`alter role "${appRolle}" createrole`);
    try {
      await expect(migrierenMitRechten(testDatenbankUrl!, appUrl)).rejects.toThrow(/nicht eingeschränkt/);
    } finally {
      await admin.unsafe(`alter role "${appRolle}" nocreaterole`);
    }
  });
});
