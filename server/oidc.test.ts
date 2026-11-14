import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createAuth, oidcKennung } from "./auth.ts";
import { EINRICHTUNGSCODE, testApp } from "./test-app.ts";
import { testDatenbankUrl } from "./test-db.ts";

/** Nachgebauter OpenID-Connect-Anbieter: Discovery, Token mit signiertem ID-Token, Schlüssel */
async function anbieter() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const zustand = { naechster: { sub: "", email: "", email_verified: true }, issuer: "", nonce: "" };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", zustand.issuer);
    const json = (daten: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(daten));
    };
    if (url.pathname === "/.well-known/openid-configuration")
      return json({
        issuer: zustand.issuer,
        authorization_endpoint: `${zustand.issuer}/authorize`,
        token_endpoint: `${zustand.issuer}/token`,
        userinfo_endpoint: `${zustand.issuer}/userinfo`,
        jwks_uri: `${zustand.issuer}/jwks`,
        id_token_signing_alg_values_supported: ["ES256"],
      });
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/userinfo") return json(zustand.naechster);
    if (url.pathname === "/token") {
      const idToken = await new SignJWT({
        ...zustand.naechster,
        name: zustand.naechster.email,
        ...(zustand.nonce ? { nonce: zustand.nonce } : {}),
      })
        .setProtectedHeader({ alg: "ES256", kid: "k1" })
        .setIssuer(zustand.issuer)
        .setAudience("belegt-client")
        .setIssuedAt()
        .setExpirationTime("5m")
        .setSubject(zustand.naechster.sub)
        .sign(privateKey);
      return json({ access_token: "zugang", token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  zustand.issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { zustand, server };
}

describe.skipIf(!testDatenbankUrl)("Anmeldung über OpenID Connect", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let a: Awaited<ReturnType<typeof anbieter>>;

  beforeAll(async () => {
    a = await anbieter();
    t = await testApp({
      oidc: { issuer: a.zustand.issuer, clientId: "belegt-client", clientSecret: "geheim", name: "Firmenkonto" },
    });
    await t.registrieren("anna@example.org");
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await new Promise<void>((ok) => a?.server.close(() => ok()));
  });

  const cookies = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c): c is string => !!c && !c.endsWith("="))
      .join("; ");

  /** Startet Anmeldung oder Verknüpfung, „meldet sich beim Anbieter an“ und kehrt mit einem Code zurück */
  async function zumAnbieter(
    person: { sub: string; email: string; email_verified: boolean },
    { verbinden, bei }: { verbinden?: string; bei?: { anfrage: typeof t.anfrage; anbieter: typeof a } } = {},
  ) {
    const anfrage = bei?.anfrage ?? t.anfrage;
    const ap = bei?.anbieter ?? a;
    ap.zustand.naechster = person;
    const start = await anfrage(
      verbinden ? "/api/auth/link-social" : "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "oidc", callbackURL: "/", errorCallbackURL: "/anmelden" }),
      },
      verbinden,
    );
    expect(start.status).toBe(200);
    const ziel = new URL(((await start.json()) as { url: string }).url);
    expect(ziel.origin).toBe(ap.zustand.issuer);
    expect(ziel.searchParams.get("code_challenge_method")).toBe("S256");
    // Was der Anbieter beim Anmelden aus der Adresse übernimmt
    ap.zustand.nonce = ziel.searchParams.get("nonce") ?? "";
    const zurueck = await anfrage(
      `/api/auth/callback/oidc?code=abc&state=${ziel.searchParams.get("state")}`,
      {},
      [verbinden, cookies(start)].filter(Boolean).join("; "),
    );
    const sitzung = cookies(zurueck)
      .split("; ")
      .filter((c) => c.includes("session_token"))
      .join("; ");
    return { ort: zurueck.headers.get("location") ?? "", sitzung };
  }

  const anna = { sub: "u-anna", email: "anna@firma.example", email_verified: true };

  it("meldet ohne Verknüpfung nicht an, auch nicht über eine bestätigte, gleiche Adresse", async () => {
    const gleich = await zumAnbieter({ sub: "u-x", email: "anna@example.org", email_verified: true });
    expect(gleich.ort).toMatch(/^\/anmelden\?error=/);
    expect(gleich.sitzung).toBe("");
  });

  it("verbindet das angemeldete Konto mit dem Anbieter; danach meldet er über sein sub an", async () => {
    const passwort = await t.anfrage("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "anna@example.org", password: "ein-langes-passwort" }),
    });
    const verbunden = await zumAnbieter(anna, { verbinden: cookies(passwort) });
    expect(verbunden.ort).toMatch(/\/$/);
    expect(await t.sql`select account_id from account where provider_id = 'oidc'`).toEqual([
      { account_id: oidcKennung(a.zustand.issuer, "u-anna") },
    ]);

    const { ort, sitzung } = await zumAnbieter(anna);
    expect(ort).toMatch(/\/$/);
    expect(await (await t.anfrage("/api/ich", {}, sitzung)).json()).toMatchObject({
      email: "anna@example.org",
      role: "inhaber",
    });
  });

  it("speichert keine Tokens des Anbieters: Belegt braucht sie nach der Anmeldung nicht", async () => {
    // Läuft nach dem Verbinden und Anmelden von anna
    expect(await t.sql`select access_token, refresh_token, id_token from account where provider_id = 'oidc'`).toEqual([
      { access_token: null, refresh_token: null, id_token: null },
    ]);
  });

  it("verbindet auch, wenn der Anbieter die Adresse nicht als bestätigt meldet (etwa Microsoft Entra)", async () => {
    const anmelden = async (email: string) =>
      t.anfrage("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "ein-langes-passwort" }),
      });
    const einladung = await t.anfrage(
      "/api/einladungen",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rolle: "steuerberatung" }),
      },
      cookies(await anmelden("anna@example.org")),
    );
    const token = ((await einladung.json()) as { pfad: string }).pfad.split("/").pop()!;
    await t.registrieren("bert@example.org", "ein-langes-passwort", { "x-belegt-einladung": token });
    const passwort = await anmelden("bert@example.org");
    const bert = { sub: "u-bert", email: "bert@firma.example", email_verified: false };
    const verbunden = await zumAnbieter(bert, { verbinden: cookies(passwort) });
    expect(verbunden.ort).not.toMatch(/error=/);
    const { sitzung } = await zumAnbieter(bert);
    expect(await (await t.anfrage("/api/ich", {}, sitzung)).json()).toMatchObject({ email: "bert@example.org" });
  });

  it("legt für eine unbekannte Person kein Konto an: Zugänge gibt es nur mit Einladung", async () => {
    const { ort, sitzung } = await zumAnbieter({ sub: "u-fremd", email: "fremd@example.org", email_verified: true });
    expect(ort).toMatch(/^\/anmelden\?error=/);
    expect(sitzung).toBe("");
    expect(await t.sql`select 1 from "user" where email = 'fremd@example.org'`).toHaveLength(0);
  });

  it("nennt die Anmeldung über den Anbieter in /api/status", async () => {
    expect(await (await t.anfrage("/api/status")).json()).toMatchObject({ oidc: { name: "Firmenkonto" } });
  });

  it("meldet nach einem Wechsel des Anbieters niemanden über dieselbe Kennung beim neuen an", async () => {
    // Belegt mit derselben Datenbank, aber OIDC_ISSUER auf einen anderen Anbieter umgestellt
    const b = await anbieter();
    try {
      const auth = createAuth({
        db: t.db,
        secret: "x".repeat(32),
        baseURL: "http://localhost:3000",
        einrichtungscode: EINRICHTUNGSCODE,
        begrenzen: false,
        oidc: { issuer: b.zustand.issuer, clientId: "belegt-client", clientSecret: "geheim", name: "Neu" },
      });
      const app = createApp({ db: t.db, speicher: t.speicher, auth, schluessel: t.schluessel, oidcName: "Neu" });
      const anfrage: typeof t.anfrage = (pfad, init = {}, cookie) =>
        app.request(`http://localhost:3000${pfad}`, {
          ...init,
          headers: {
            origin: "http://localhost:3000",
            ...(cookie ? { cookie } : {}),
            ...(init.headers as Record<string, string> | undefined),
          },
        });
      // Beim neuen Anbieter hat eine andere Person zufällig dieselbe Kennung wie anna beim alten
      const fremd = await zumAnbieter(
        { sub: anna.sub, email: "jemand@anders.example", email_verified: true },
        { bei: { anfrage, anbieter: b } },
      );
      expect(fremd.ort).toMatch(/^\/anmelden\?error=/);
      expect(fremd.sitzung).toBe("");
    } finally {
      await new Promise<void>((ok) => b.server.close(() => ok()));
    }
  });
});
