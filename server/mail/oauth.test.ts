import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entschluesseln } from "../crypto.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { abrufen, type Zugang } from "./abruf.ts";
import { starten, vorgangLesen } from "./oauth.ts";

const schluessel = Buffer.alloc(32, 7);
const google = { clientId: "client-g", clientSecret: "geheim-g" };
const microsoft = { clientId: "client-m", clientSecret: "geheim-m", tenant: "common" };
const idToken = (email: string) => `kopf.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.signatur`;

describe("OAuth-Vorgang", () => {
  it("baut die Adresse mit PKCE (S256) und legt den Verifier nur ins verschlüsselte Cookie", () => {
    const { url, cookie } = starten("google", google, "https://belegt.example/api/oauth/rueckkehr", schluessel, {
      name: "Gmail",
      ordner: "INBOX",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toContain("https://mail.google.com/");
    expect(u.searchParams.get("access_type")).toBe("offline");
    const v = vorgangLesen(cookie, u.searchParams.get("state")!, schluessel)!;
    expect(u.searchParams.get("code_challenge")).toBe(createHash("sha256").update(v.verifier).digest("base64url"));
    expect(url).not.toContain(v.verifier);
    expect(vorgangLesen(cookie, "anderer-state", schluessel)).toBeNull();
    expect(vorgangLesen(cookie, v.state, Buffer.alloc(32, 8))).toBeNull();
    const mitte = Math.floor(cookie.length / 2);
    const verfaelscht = cookie.slice(0, mitte) + (cookie[mitte] === "A" ? "B" : "A") + cookie.slice(mitte + 1);
    expect(vorgangLesen(verfaelscht, v.state, schluessel)).toBeNull();
  });
});

describe.skipIf(!testDatenbankUrl)("OAuth gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfragen: { url: string; felder: URLSearchParams }[] = [];
  let naechstesRefresh = "refresh-1";
  const abfragen = async (url: string, init: RequestInit) => {
    const felder = new URLSearchParams(String(init.body));
    anfragen.push({ url, felder });
    if (felder.get("code") === "falsch") return Response.json({ error: "invalid_grant" }, { status: 400 });
    const email = url.includes("google") ? "anna@gmail.example" : "anna@firma.example";
    return Response.json({
      access_token: `access-für-${email}`,
      refresh_token: naechstesRefresh,
      id_token: idToken(email),
    });
  };
  const zuletzt: { zugang: Zugang | null } = { zugang: null };
  const oeffnen = async (zugang: Zugang) => {
    zuletzt.zugang = zugang;
    return { uidValidity: 1, async *neue() {}, async schliessen() {} };
  };

  beforeAll(async () => {
    t = await testApp({ oauth: { google, microsoft }, abfragen, oeffnen });
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  async function verbinden(anbieter: string, code = "richtig") {
    const start = await t.anfrage(`/api/oauth/${anbieter}/start?name=${anbieter}-Postfach`, {}, cookie);
    expect(start.status).toBe(302);
    const ziel = new URL(start.headers.get("location")!);
    const oauthCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    expect(start.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    return t.anfrage(
      `/api/oauth/rueckkehr?code=${code}&state=${ziel.searchParams.get("state")}`,
      {},
      `${cookie}; ${oauthCookie}`,
    );
  }

  it("verbindet ein Gmail-Postfach: Refresh-Token nur verschlüsselt, Adresse aus dem ID-Token", async () => {
    const res = await verbinden("google");
    expect(res.headers.get("location")).toBe("/quellen?oauth=verbunden");
    const [q] = await t.sql`select * from quellen where oauth = 'google'`;
    expect(q).toMatchObject({
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      benutzer: "anna@gmail.example",
      art: "imap",
    });
    expect(entschluesseln(t.schluessel, q!.ciphertext).toString()).toBe("refresh-1");
    // Der Tausch schickte den Verifier, das Geheimnis der App und die Rückkehradresse
    const tausch = anfragen.at(-1)!;
    expect(tausch.url).toBe("https://oauth2.googleapis.com/token");
    expect(tausch.felder.get("grant_type")).toBe("authorization_code");
    expect(tausch.felder.get("code_verifier")).toMatch(/^[\w-]{40,}$/);
    expect(tausch.felder.get("redirect_uri")).toMatch(/\/api\/oauth\/rueckkehr$/);
    expect(JSON.stringify(await t.sql`select new_value from audit_log where table_name = 'quellen'`)).not.toContain(
      "refresh-1",
    );
  });

  it("ruft mit einem Access-Token ab und merkt sich das neue Refresh-Token, das Microsoft schickt", async () => {
    naechstesRefresh = "refresh-m1";
    await verbinden("microsoft");
    const [q] = await t.sql`select id from quellen where oauth = 'microsoft'`;
    naechstesRefresh = "refresh-m2";
    const ergebnis = await abrufen(t, t.schluessel, q!.id, oeffnen, { oauth: { microsoft }, abfragen });
    expect(ergebnis.fehler).toBeNull();
    expect(zuletzt.zugang).toMatchObject({
      host: "outlook.office365.com",
      benutzer: "anna@firma.example",
      accessToken: "access-für-anna@firma.example",
    });
    expect(anfragen.at(-1)!.felder.get("refresh_token")).toBe("refresh-m1");
    const [neu] = await t.sql`select ciphertext from quellen where id = ${q!.id}`;
    expect(entschluesseln(t.schluessel, neu!.ciphertext).toString()).toBe("refresh-m2");

    // Ohne eingerichtete App ein Fehler am Postfach, kein Abruf mit leerem Passwort
    const ohne = await abrufen(t, t.schluessel, q!.id, oeffnen, { abfragen });
    expect(ohne.fehler).toBe("OAuth für microsoft ist auf dem Server nicht eingerichtet");
  });

  it("legt bei falschem state, Ablehnung oder Fehler beim Tausch nichts an", async () => {
    const vorher = (await t.sql`select count(*)::int as n from quellen`)[0]!.n;
    expect((await verbinden("google", "falsch")).headers.get("location")).toBe("/quellen?oauth=fehler");
    const ohneCookie = await t.anfrage("/api/oauth/rueckkehr?code=richtig&state=x", {}, cookie);
    expect(ohneCookie.headers.get("location")).toBe("/quellen?oauth=abgelaufen");
    expect((await t.sql`select count(*)::int as n from quellen`)[0]!.n).toBe(vorher);
  });

  it("nennt die eingerichteten Anbieter und lässt nur den Inhaber verbinden", async () => {
    expect(await (await t.anfrage("/api/oauth", {}, cookie)).json()).toMatchObject({
      anbieter: ["microsoft", "google"],
    });
    expect((await t.anfrage("/api/oauth/yahoo/start?name=x", {}, cookie)).status).toBe(404);
    expect((await t.anfrage("/api/oauth/google/start", {}, cookie)).status).toBe(400);
    const { pfad } = await (
      await t.anfrage(
        "/api/einladungen",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rolle: "steuerberatung" }),
        },
        cookie,
      )
    ).json();
    const kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
    expect((await t.anfrage("/api/oauth/google/start?name=x", {}, kanzlei)).status).toBe(403);
  });
});
