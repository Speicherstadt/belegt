import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VERSION } from "./http/gemeinsam.ts";
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

  it("meldet öffentlich, ob schon eingerichtet ist", async () => {
    expect(await (await t.anfrage("/api/status")).json()).toEqual({
      eingerichtet: false,
      oidc: null,
      embedOrigin: null,
      version: VERSION,
    });
  });

  it("verlangt für das erste Konto den Einrichtungscode", async () => {
    expect((await t.registrieren("eve@example.org", "ein-langes-passwort", {})).res.status).toBe(403);
    expect(
      (await t.registrieren("eve@example.org", "ein-langes-passwort", { "x-belegt-einrichtungscode": "falsch" })).res
        .status,
    ).toBe(403);
    expect(await t.sql`select 1 from "user"`).toHaveLength(0);
  });

  it("lehnt zu kurze Passwörter auch mit Einrichtungscode ab", async () => {
    const { res } = await t.registrieren("kurz@example.org", "kurz");
    expect(res.status).toBe(400);
  });

  it("macht das erste Konto zum Inhaber und lehnt jedes weitere ab", async () => {
    const { res, cookie } = await t.registrieren("anna@example.org");
    expect(res.status).toBe(200);
    expect(await (await t.anfrage("/api/ich", {}, cookie)).json()).toMatchObject({
      email: "anna@example.org",
      role: "inhaber",
    });

    expect(await (await t.anfrage("/api/status")).json()).toEqual({
      eingerichtet: true,
      oidc: null,
      embedOrigin: null,
      version: VERSION,
    });
    const zweites = await t.registrieren("mallory@example.org");
    expect(zweites.res.status).toBe(403);
    expect(await t.sql`select 1 from "user" where email = 'mallory@example.org'`).toHaveLength(0);
  });

  it("lehnt Änderungen am Konto über Better Auth ab, auch an der Rolle", async () => {
    const { cookie } = await t.registrieren("anna@example.org").catch(() => ({ cookie: "" }));
    const anmelden = await t.anfrage("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "anna@example.org", password: "ein-langes-passwort" }),
    });
    const sitzung =
      anmelden.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ") || cookie;
    const res = await t.anfrage(
      "/api/auth/update-user",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Mallory", role: "inhaber" }),
      },
      sitzung,
    );
    expect(res.status).toBe(403);
    const [u] = await t.sql`select name from "user" where email = 'anna@example.org'`;
    expect(u!.name).toBe("anna@example.org");
  });

  it("legt mit einer Einladung genau einen Zugang mit ihrer Rolle an, einmal", async () => {
    const inhaber = (
      await t.anfrage("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "anna@example.org", password: "ein-langes-passwort" }),
      })
    ).headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const res = await t.anfrage(
      "/api/einladungen",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rolle: "steuerberatung" }),
      },
      inhaber,
    );
    expect(res.status).toBe(201);
    const { pfad } = await res.json();
    const token = pfad.split("/").pop();
    expect(await (await t.anfrage(`/api/einladung/${token}`)).json()).toEqual({
      rolle: "steuerberatung",
      zeitraumVon: null,
      zeitraumBis: null,
    });
    expect(await t.sql`select 1 from einladungen where token_hash = ${token}`).toHaveLength(0);

    const kanzlei = await t.registrieren("kanzlei@example.org", "ein-langes-passwort", { "x-belegt-einladung": token });
    expect(kanzlei.res.status).toBe(200);
    expect(await (await t.anfrage("/api/ich", {}, kanzlei.cookie)).json()).toMatchObject({ role: "steuerberatung" });
    expect((await t.anfrage("/api/zugaenge", {}, kanzlei.cookie)).status).toBe(403);

    expect(
      (await t.registrieren("zweiter@example.org", "ein-langes-passwort", { "x-belegt-einladung": token })).res.status,
    ).toBe(403);
    expect((await t.anfrage(`/api/einladung/${token}`)).status).toBe(404);

    const liste = await (await t.anfrage("/api/zugaenge", {}, inhaber)).json();
    expect(liste.zugaenge.map((z: { email: string; rolle: string }) => [z.email, z.rolle])).toEqual([
      ["anna@example.org", "inhaber"],
      ["kanzlei@example.org", "steuerberatung"],
    ]);
    expect(JSON.stringify(liste)).not.toContain(token);

    const zweite = await (
      await t.anfrage(
        "/api/einladungen",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rolle: "pruefer", zeitraum: { von: "2024-01-01", bis: "2024-12-31" } }),
        },
        inhaber,
      )
    ).json();
    expect((await t.anfrage(`/api/einladungen/${zweite.id}/zurueckziehen`, { method: "POST" }, inhaber)).status).toBe(
      200,
    );
    expect(
      (
        await t.registrieren("pruefer@example.org", "ein-langes-passwort", {
          "x-belegt-einladung": zweite.pfad.split("/").pop(),
        })
      ).res.status,
    ).toBe(403);
    expect(
      (
        await t.anfrage(
          "/api/einladungen",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ rolle: "inhaber" }),
          },
          inhaber,
        )
      ).status,
    ).toBe(400);
  });

  it("schreibt Zugänge ins Audit-Log, ohne Passwort-Hash", async () => {
    const [konto] = await t.sql`select new_value from audit_log where table_name = 'account' and action = 'INSERT'`;
    expect(konto!.new_value).not.toHaveProperty("password");
    expect(await t.sql`select 1 from audit_log where table_name = 'user' and action = 'INSERT'`).toHaveLength(2);
    const einladungen = await t.sql`select new_value from audit_log where table_name = 'einladungen'`;
    expect(JSON.stringify(einladungen)).not.toContain("token_hash");
  });
});

describe.skipIf(!testDatenbankUrl)("Begrenzung der Anmeldeversuche", () => {
  it("antwortet nach zu vielen falschen Passwörtern mit 429", async () => {
    const t = await testApp({ begrenzen: true });
    try {
      await t.registrieren("anna@example.org");
      const versuch = () =>
        t.anfrage("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
          body: JSON.stringify({ email: "anna@example.org", password: "falsch-falsch-falsch" }),
        });
      const status: number[] = [];
      for (let i = 0; i < 25; i++) status.push((await versuch()).status);
      expect(status).toContain(429);
    } finally {
      await t.aufraeumen();
    }
  });
});
