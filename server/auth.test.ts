import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "./test-app.ts";
import { testDatenbankUrl } from "./test-db.ts";

describe.skipIf(!testDatenbankUrl)("Anmeldung gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => {
    t = await testApp();
  });
  afterAll(() => t?.aufraeumen());

  it("verlangt für /api eine Sitzung", async () => {
    expect((await t.anfrage("/api/dokumente")).status).toBe(401);
    expect((await t.anfrage("/api/pruefung")).status).toBe(401);
  });

  it("macht das erste Konto zum Inhaber und lehnt jedes weitere ab", async () => {
    const { res, cookie } = await t.registrieren("anna@example.org");
    expect(res.status).toBe(200);
    expect(await (await t.anfrage("/api/ich", {}, cookie)).json()).toMatchObject({
      email: "anna@example.org",
      role: "inhaber",
    });

    const zweites = await t.registrieren("mallory@example.org");
    expect(zweites.res.status).toBe(403);
    expect(await t.sql`select 1 from "user" where email = 'mallory@example.org'`).toHaveLength(0);
  });

  it("lehnt zu kurze Passwörter ab", async () => {
    const { res } = await t.registrieren("kurz@example.org", "kurz");
    expect(res.status).toBe(400);
  });

  it("schreibt Zugänge ins Audit-Log, ohne Passwort-Hash", async () => {
    const [konto] = await t.sql`select new_value from audit_log where table_name = 'account' and action = 'INSERT'`;
    expect(konto!.new_value).not.toHaveProperty("password");
    expect(await t.sql`select 1 from audit_log where table_name = 'user' and action = 'INSERT'`).toHaveLength(1);
  });
});
