import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { notfallZuruecksetzen } from "./notfall.ts";

describe.skipIf(!testDatenbankUrl)("Notfall: zweiten Faktor des Inhabers zurücksetzen", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  const fremd = `belegt_notfalltest_${process.pid}`;
  beforeAll(async () => {
    t = await testApp();
  });
  afterAll(async () => {
    await t?.sql.unsafe(`drop owned by "${fremd}"`).catch(() => {});
    await t?.sql.unsafe(`drop role if exists "${fremd}"`).catch(() => {});
    await t?.aufraeumen();
  });

  it("läuft nur als Eigentümer und steht mit system:notfall im Audit-Log", async () => {
    const { cookie } = await t.registrieren("anna@example.org");
    await t.anfrage(
      "/api/auth/two-factor/enable",
      { method: "POST", headers: { "content-type": "application/json" }, body: '{"password":"ein-langes-passwort"}' },
      cookie,
    );
    await t.sql`update "user" set two_factor_enabled = true`;

    // Eine Anmeldung ohne Eigentum (wie die App-Rolle) bricht ab, bevor sie etwas ändert
    await t.sql.unsafe(`create role "${fremd}" login password 'notfall-test' nosuperuser nocreatedb nocreaterole`);
    await t.sql.unsafe(`grant select, update, delete on all tables in schema public to "${fremd}"`);
    const u = new URL(testDatenbankUrl!);
    u.username = fremd;
    u.password = "notfall-test";
    const app = postgres(u.toString(), { max: 1, onnotice: () => {} });
    await expect(notfallZuruecksetzen(app, "anna@example.org")).rejects.toThrow(/Eigentümer/);
    await app.end();
    expect(await t.sql`select 1 from two_factor`).toHaveLength(1);

    await expect(notfallZuruecksetzen(t.sql, "niemand@example.org")).rejects.toThrow(/Kein Zugang/);
    expect(await notfallZuruecksetzen(t.sql, "Anna@example.org")).toMatch(/zurückgesetzt/);
    expect(await t.sql`select two_factor_enabled from "user"`).toEqual([{ two_factor_enabled: false }]);
    expect(await t.sql`select 1 from two_factor`).toHaveLength(0);
    expect((await t.anfrage("/api/ich", {}, cookie)).status).toBe(401);
    expect(
      await t.sql`select distinct actor from audit_log where table_name = 'two_factor' and action = 'DELETE'`,
    ).toEqual([{ actor: "system:notfall" }]);
  });
});
