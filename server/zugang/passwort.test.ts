import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { notfallLink } from "./notfall-passwort.ts";

describe.skipIf(!testDatenbankUrl)("Passwort vergessen gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const ALT = "ein-langes-passwort";
  const NEU = "ein-ganz-neues-passwort";
  const fremd = `belegt_passworttest_${process.pid}`;

  const post = (pfad: string, body: unknown, cookie?: string) =>
    t.anfrage(
      pfad,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );
  const anmelden = (email: string, passwort: string) => post("/api/auth/sign-in/email", { email, password: passwort });
  const idVon = async (email: string) =>
    ((await t.sql`select id from "user" where email = ${email}`) as unknown as [{ id: string }])[0].id;
  const linkFuer = async (email: string, cookie = inhaber) => {
    const res = await post(`/api/zugaenge/${await idVon(email)}/passwort-zuruecksetzen`, {}, cookie);
    return { res, pfad: ((await res.json()) as { pfad?: string }).pfad };
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(async () => {
    await t?.sql.unsafe(`drop owned by "${fremd}"`).catch(() => {});
    await t?.sql.unsafe(`drop role if exists "${fremd}"`).catch(() => {});
    await t?.aufraeumen();
  });

  it("setzt das Passwort mit dem Link neu, einmal, und beendet die Sitzungen", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "tom@example.org", { rolle: "steuerberatung" });
    const { res, pfad } = await linkFuer("tom@example.org");
    expect(res.status).toBe(200);
    expect(pfad).toMatch(/^\/passwort\/[A-Za-z0-9_-]{40,}$/);
    const token = pfad!.split("/").pop()!;

    // Zu kurz: Link bleibt gültig
    expect((await post(`/api/passwort/${token}`, { passwort: "kurz" })).status).toBe(400);
    expect((await post(`/api/passwort/${token}`, { passwort: NEU })).status).toBe(200);

    expect((await t.anfrage("/api/ich", {}, zugang)).status).toBe(401);
    expect((await anmelden("tom@example.org", ALT)).status).toBe(401);
    expect((await anmelden("tom@example.org", NEU)).status).toBe(200);
    // Ein zweites Mal geht der Link nicht
    expect((await post(`/api/passwort/${token}`, { passwort: "noch-ein-passwort-1" })).status).toBe(404);
    expect((await anmelden("tom@example.org", NEU)).status).toBe(200);

    // Audit mit Akteuren, ohne Token und ohne Hashes
    const akteure = await t.sql`select distinct actor, table_name from audit_log
      where table_name in ('passwort_links', 'account') and actor like 'nutzer:anna%' or actor = 'system:passwort-link'`;
    expect(akteure.map((a) => `${a.table_name}:${a.actor}`)).toEqual(
      expect.arrayContaining(["passwort_links:nutzer:anna@example.org", "account:system:passwort-link"]),
    );
    const alles =
      JSON.stringify(await t.sql`select * from audit_log`) + JSON.stringify(await t.sql`select * from passwort_links`);
    expect(alles).not.toContain(token);
    const [{ hash }] = (await t.sql`select token_hash as hash from passwort_links`) as unknown as [{ hash: string }];
    expect(
      JSON.stringify(await t.sql`select new_value, old_value from audit_log where table_name = 'passwort_links'`),
    ).not.toContain(hash);
  });

  it("macht den älteren Link ungültig, wenn ein neuer entsteht, und lässt abgelaufene nicht zu", async () => {
    await zugangAnlegen(t, inhaber, "alt@example.org", { rolle: "steuerberatung" });
    const erster = (await linkFuer("alt@example.org")).pfad!.split("/").pop()!;
    const zweiter = (await linkFuer("alt@example.org")).pfad!.split("/").pop()!;
    expect((await post(`/api/passwort/${erster}`, { passwort: NEU })).status).toBe(404);

    await t.sql`update passwort_links set gueltig_bis = now() - interval '1 minute'`;
    expect((await post(`/api/passwort/${zweiter}`, { passwort: NEU })).status).toBe(404);
    expect((await anmelden("alt@example.org", ALT)).status).toBe(200);
  });

  it("lässt den zweiten Faktor unberührt", async () => {
    await zugangAnlegen(t, inhaber, "faktor@example.org", { rolle: "steuerberatung" });
    await t.sql`update "user" set two_factor_enabled = true where email = 'faktor@example.org'`;
    const token = (await linkFuer("faktor@example.org")).pfad!.split("/").pop()!;
    expect((await post(`/api/passwort/${token}`, { passwort: NEU })).status).toBe(200);
    expect(await t.sql`select two_factor_enabled from "user" where email = 'faktor@example.org'`).toEqual([
      { two_factor_enabled: true },
    ]);
  });

  it("verlangt den Inhaber mit Sitzung, nie den eigenen Zugang, und kennt die ID", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "mia@example.org", { rolle: "steuerberatung" });
    const anna = await idVon("anna@example.org");
    expect((await linkFuer("anna@example.org", zugang)).res.status).toBe(403);
    expect((await post(`/api/zugaenge/${anna}/passwort-zuruecksetzen`, {}, inhaber)).status).toBe(400);
    expect((await post(`/api/zugaenge/unbekannt/passwort-zuruecksetzen`, {}, inhaber)).status).toBe(404);
    // Ein entzogener Zugang bekommt keinen Link
    await post(`/api/zugaenge/${await idVon("mia@example.org")}/entziehen`, {}, inhaber);
    expect((await linkFuer("mia@example.org")).res.status).toBe(404);
  });

  it("bedient keinen entzogenen Zugang: Entziehen löscht offene Links, das Passwort bleibt", async () => {
    await zugangAnlegen(t, inhaber, "weg@example.org", { rolle: "steuerberatung" });
    const id = await idVon("weg@example.org");
    const token = (await linkFuer("weg@example.org")).pfad!.split("/").pop()!;
    await post(`/api/zugaenge/${id}/entziehen`, {}, inhaber);
    expect(await t.sql`select 1 from passwort_links where user_id = ${id}`).toHaveLength(0);
    expect((await post(`/api/passwort/${token}`, { passwort: NEU })).status).toBe(404);

    // Auch ein Link, den das Löschen nicht erwischt hätte, bedient keinen entzogenen Zugang
    await t.sql`update "user" set entzogen_am = null where id = ${id}`;
    const spaet = (await linkFuer("weg@example.org")).pfad!.split("/").pop()!;
    await t.sql`update "user" set entzogen_am = now() where id = ${id}`;
    const [vorher] = await t.sql`select password from account where user_id = ${id}`;
    expect((await post(`/api/passwort/${spaet}`, { passwort: NEU })).status).toBe(404);
    expect(await t.sql`select password from account where user_id = ${id}`).toEqual([vorher]);
  });

  it("antwortet ohne Konto mit Passwort mit 404, nicht mit 500, und stellt dafür keinen Link aus", async () => {
    await zugangAnlegen(t, inhaber, "ohne@example.org", { rolle: "steuerberatung" });
    const token = (await linkFuer("ohne@example.org")).pfad!.split("/").pop()!;
    await t.sql`update account set provider_id = 'oidc' where user_id = ${await idVon("ohne@example.org")}`;
    const res = await post(`/api/passwort/${token}`, { passwort: NEU });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { fehler: string }).fehler).toMatch(/Link/);
    // Nur über den OIDC-Anbieter: kein Link
    expect((await linkFuer("ohne@example.org")).res.status).toBe(404);
    const liste = (await (await t.anfrage("/api/zugaenge", {}, inhaber)).json()) as {
      zugaenge: { email: string; passwort: boolean }[];
    };
    expect(liste.zugaenge.find((z) => z.email === "ohne@example.org")?.passwort).toBe(false);
    expect(liste.zugaenge.find((z) => z.email === "anna@example.org")?.passwort).toBe(true);
  });

  it("löst bei zwei gleichzeitigen Aufrufen den Link genau einmal ein", async () => {
    await zugangAnlegen(t, inhaber, "doppelt@example.org", { rolle: "steuerberatung" });
    const token = (await linkFuer("doppelt@example.org")).pfad!.split("/").pop()!;
    const antworten = await Promise.all([
      post(`/api/passwort/${token}`, { passwort: NEU }),
      post(`/api/passwort/${token}`, { passwort: "zweites-neues-passwort" }),
    ]);
    expect(antworten.map((r) => r.status).sort()).toEqual([200, 404]);
  });

  it("Notfall: gibt den Link nur dem Eigentümer, für den Inhaber, mit system:notfall", async () => {
    await t.sql.unsafe(`create role "${fremd}" login password 'notfall-test' nosuperuser nocreatedb nocreaterole`);
    await t.sql.unsafe(`grant select, insert, update, delete on all tables in schema public to "${fremd}"`);
    const u = new URL(testDatenbankUrl!);
    u.username = fremd;
    u.password = "notfall-test";
    const app = postgres(u.toString(), { max: 1, onnotice: () => {} });
    await expect(notfallLink(app, "anna@example.org", "http://localhost:3000")).rejects.toThrow(/Eigentümer/);
    await app.end();
    await expect(notfallLink(t.sql, "niemand@example.org", "http://localhost:3000")).rejects.toThrow(/Kein Zugang/);

    const link = await notfallLink(t.sql, "Anna@example.org", "http://localhost:3000");
    expect(link).toMatch(/^http:\/\/localhost:3000\/passwort\/[A-Za-z0-9_-]{40,}$/);
    expect((await post(`/api/passwort/${link.split("/").pop()}`, { passwort: NEU })).status).toBe(200);
    expect((await t.anfrage("/api/ich", {}, inhaber)).status).toBe(401);
    expect((await anmelden("anna@example.org", NEU)).status).toBe(200);
    expect(
      await t.sql`select distinct actor from audit_log where table_name = 'passwort_links' and action = 'INSERT' and actor = 'system:notfall'`,
    ).toEqual([{ actor: "system:notfall" }]);
  });
});
