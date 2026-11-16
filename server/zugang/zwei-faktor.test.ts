import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { softwarePasskey } from "../test-passkey.ts";
import { geheimnisAus, totpCode } from "../test-totp.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { anmeldewegAus, einrichtungNoetig, mitZweitemFaktor } from "./zwei-faktor.ts";

describe("Anmeldeweg und Pflicht", () => {
  it("leitet den Anmeldeweg aus dem Aufruf ab, der die Sitzung anlegt", () => {
    expect(anmeldewegAus("/sign-in/email")).toBe("passwort");
    expect(anmeldewegAus("/sign-up/email")).toBe("passwort");
    expect(anmeldewegAus("/two-factor/verify-totp")).toBe("zwei_faktor");
    expect(anmeldewegAus("/two-factor/verify-backup-code")).toBe("zwei_faktor");
    expect(anmeldewegAus("/passkey/verify-authentication")).toBe("passkey");
    expect(anmeldewegAus("/callback/:id")).toBe("oidc");
    expect(anmeldewegAus(undefined)).toBe("passwort");
  });

  it("verlangt die Einrichtung nur bei Pflicht für die Rolle und einer Sitzung ohne zweiten Faktor", () => {
    expect(einrichtungNoetig(["mitarbeiter"], "mitarbeiter", "passwort")).toBe(true);
    expect(einrichtungNoetig(["mitarbeiter"], "steuerberatung", "passwort")).toBe(false);
    // Über den OIDC-Anbieter ist der Anbieter für die Anmeldung zuständig
    expect(einrichtungNoetig(["mitarbeiter"], "mitarbeiter", "oidc")).toBe(false);
    expect(mitZweitemFaktor("passkey")).toBe(true);
    expect(mitZweitemFaktor(null)).toBe(false);
  });
});

/** Die Cookies einer Antwort für die nächste Anfrage; abgelaufene (Max-Age=0) fallen weg */
function cookiesAus(res: Response, vorher = ""): string {
  const alle = new Map(
    vorher
      .split("; ")
      .filter(Boolean)
      .map((c) => [c.split("=")[0]!, c] as const),
  );
  for (const c of res.headers.getSetCookie()) {
    const [paar] = c.split(";");
    const name = paar!.split("=")[0]!;
    if (/max-age=0/i.test(c) || paar!.endsWith("=")) alle.delete(name);
    else alle.set(name, paar!);
  }
  return [...alle.values()].join("; ");
}

describe.skipIf(!testDatenbankUrl)("Zwei-Faktor-Anmeldung gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const PASSWORT = "ein-langes-passwort";

  const post = (pfad: string, body: unknown, cookie?: string) =>
    t.anfrage(
      pfad,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      cookie,
    );

  const anmelden = (email: string, passwort = PASSWORT) =>
    post("/api/auth/sign-in/email", { email, password: passwort });

  /** Richtet TOTP für die Sitzung ein und bestätigt es; gibt Geheimnis, Backup-Codes und das neue Cookie zurück */
  async function totpEinrichten(cookie: string) {
    const res = await post("/api/auth/two-factor/enable", { password: PASSWORT }, cookie);
    expect(res.status).toBe(200);
    const { totpURI, backupCodes } = (await res.json()) as { totpURI: string; backupCodes: string[] };
    const geheimnis = geheimnisAus(totpURI);
    const bestaetigt = await post("/api/auth/two-factor/verify-totp", { code: totpCode(geheimnis) }, cookie);
    expect(bestaetigt.status).toBe(200);
    return { geheimnis, backupCodes, totpURI, cookie: cookiesAus(bestaetigt, cookie) };
  }

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());
  afterEach(() => vi.useRealTimers());

  it("richtet TOTP mit Bestätigung ein; ein falscher Code bestätigt nichts", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "tom@example.org", { rolle: "steuerberatung" });
    const res = await post("/api/auth/two-factor/enable", { password: PASSWORT }, zugang);
    const { totpURI, backupCodes } = (await res.json()) as { totpURI: string; backupCodes: string[] };
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/Belegt:tom%40example\.org\?/);
    expect(backupCodes).toHaveLength(10);
    // Noch nicht bestätigt: kein zweiter Faktor
    expect(await t.sql`select two_factor_enabled from "user" where email = 'tom@example.org'`).toEqual([
      { two_factor_enabled: false },
    ]);
    const code = totpCode(geheimnisAus(totpURI));
    const falsch = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    expect((await post("/api/auth/two-factor/verify-totp", { code: falsch }, zugang)).status).toBe(401);
    const bestaetigt = await post("/api/auth/two-factor/verify-totp", { code }, zugang);
    expect(bestaetigt.status).toBe(200);
    expect(await t.sql`select two_factor_enabled from "user" where email = 'tom@example.org'`).toEqual([
      { two_factor_enabled: true },
    ]);
    // Better Auth ersetzt dabei die Sitzung; die neue zählt als mit zweitem Faktor
    const neu = cookiesAus(bestaetigt, zugang);
    expect((await t.anfrage("/api/ich", {}, zugang)).status).toBe(401);
    // Den QR-Code erzeugt Belegt selbst
    const qr = await post("/api/konto/qr", { text: totpURI }, neu);
    expect(qr.status).toBe(200);
    expect(((await qr.json()) as { pfad: string }).pfad).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect((await post("/api/konto/qr", { text: "https://example.org" }, neu)).status).toBe(400);
  });

  it("verlangt nach dem Passwort den TOTP-Code zur richtigen Zeit", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "zeit@example.org", { rolle: "steuerberatung" });
    const { geheimnis } = await totpEinrichten(zugang);
    const jetzt = new Date("2026-11-16T10:00:10Z").getTime();
    vi.useFakeTimers({ toFake: ["Date"], now: jetzt });

    const schritt1 = await anmelden("zeit@example.org");
    expect(await schritt1.json()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    const halb = cookiesAus(schritt1);
    // Ohne zweiten Schritt keine Sitzung
    expect((await t.anfrage("/api/ich", {}, halb)).status).toBe(401);
    // Ein Code von vor zwei Minuten gilt nicht mehr
    const alt = await post("/api/auth/two-factor/verify-totp", { code: totpCode(geheimnis, jetzt - 120_000) }, halb);
    expect(alt.status).toBe(401);
    const ok = await post("/api/auth/two-factor/verify-totp", { code: totpCode(geheimnis, jetzt) }, halb);
    expect(ok.status).toBe(200);
    const sitzung = cookiesAus(ok, halb);
    expect(await (await t.anfrage("/api/ich", {}, sitzung)).json()).toMatchObject({ email: "zeit@example.org" });
    const [s] = await t.sql`select s.anmeldeweg from session s join "user" u on u.id = s.user_id
      where u.email = 'zeit@example.org' order by s.created_at desc limit 1`;
    expect(s).toEqual({ anmeldeweg: "zwei_faktor" });
  });

  it("nimmt jeden Backup-Code genau einmal", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "backup@example.org", { rolle: "steuerberatung" });
    const { backupCodes } = await totpEinrichten(zugang);
    const halb1 = cookiesAus(await anmelden("backup@example.org"));
    const erst = await post("/api/auth/two-factor/verify-backup-code", { code: backupCodes[0] }, halb1);
    expect(erst.status).toBe(200);
    expect((await t.anfrage("/api/ich", {}, cookiesAus(erst, halb1))).status).toBe(200);
    const halb2 = cookiesAus(await anmelden("backup@example.org"));
    expect((await post("/api/auth/two-factor/verify-backup-code", { code: backupCodes[0] }, halb2)).status).toBe(401);
    expect((await post("/api/auth/two-factor/verify-backup-code", { code: backupCodes[1] }, halb2)).status).toBe(200);
  });

  it("speichert TOTP-Geheimnis und Backup-Codes verschlüsselt und nie im Audit-Log", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "geheim@example.org", { rolle: "steuerberatung" });
    const { totpURI, backupCodes } = await totpEinrichten(zugang);
    const base32 = new URL(totpURI).searchParams.get("secret")!;
    const [zeile] = await t.sql<{ secret: string; backup_codes: string }[]>`
      select f.secret, f.backup_codes from two_factor f join "user" u on u.id = f.user_id
       where u.email = 'geheim@example.org'`;
    const geheimnis = geheimnisAus(totpURI).toString();
    for (const wert of [zeile!.secret, zeile!.backup_codes]) {
      expect(wert).not.toContain(geheimnis);
      expect(wert).not.toContain(base32);
      for (const code of backupCodes) expect(wert).not.toContain(code);
    }
    const protokoll = await t.sql<{ alt: unknown; neu: unknown }[]>`
      select old_value as alt, new_value as neu from audit_log where table_name = 'two_factor'`;
    expect(protokoll.length).toBeGreaterThan(0);
    const text = JSON.stringify(protokoll);
    expect(text).not.toContain('"secret"');
    expect(text).not.toContain('"backup_codes"');
    expect(text).not.toContain(zeile!.secret);
  });

  it("registriert einen Passkey, meldet damit an und lässt das Passwort allein dann nicht mehr gelten", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "pia@example.org", { rolle: "steuerberatung" });
    const schluessel = softwarePasskey("http://localhost:3000");
    const reg = await t.anfrage("/api/auth/passkey/generate-register-options", {}, zugang);
    const regOptionen = await reg.json();
    expect(regOptionen.rp).toEqual({ name: "Belegt", id: "localhost" });
    const regCookie = cookiesAus(reg, zugang);
    const registriert = await post(
      "/api/auth/passkey/verify-registration",
      { response: schluessel.registrieren(regOptionen), name: "Laptop" },
      regCookie,
    );
    expect(registriert.status).toBe(200);
    expect(await (await t.anfrage("/api/konto", {}, zugang)).json()).toMatchObject({
      totp: false,
      passkeys: [{ name: "Laptop" }],
    });

    // Mit Passkey anmelden, ohne Sitzung
    const auth = await t.anfrage("/api/auth/passkey/generate-authenticate-options");
    const authOptionen = await auth.json();
    const angemeldet = await post(
      "/api/auth/passkey/verify-authentication",
      { response: schluessel.anmelden(authOptionen) },
      cookiesAus(auth),
    );
    expect(angemeldet.status).toBe(200);
    expect((await t.anfrage("/api/ich", {}, cookiesAus(angemeldet, cookiesAus(auth)))).status).toBe(200);
    const [s] = await t.sql`select s.anmeldeweg from session s join "user" u on u.id = s.user_id
      where u.email = 'pia@example.org' order by s.created_at desc limit 1`;
    expect(s).toEqual({ anmeldeweg: "passkey" });

    // Passwort allein: abgelehnt, keine Sitzung
    const nurPasswort = await anmelden("pia@example.org");
    expect(nurPasswort.status).toBe(403);
    expect((await t.anfrage("/api/ich", {}, cookiesAus(nurPasswort))).status).toBe(401);
    // Ein falsches Passwort verrät nicht, dass der Zugang Passkeys hat
    expect((await anmelden("pia@example.org", "falsches-passwort-123")).status).toBe(401);
  });

  it("erzwingt bei Pflicht die Einrichtung, bevor der Zugang etwas anderes aufruft", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "mia@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: {},
    });
    // Nur der Inhaber legt die Pflicht fest
    const verweigert = await t.anfrage(
      "/api/zwei-faktor",
      { method: "PUT", headers: { "content-type": "application/json" }, body: '{"rollen":["mitarbeiter"]}' },
      zugang,
    );
    expect(verweigert.status).toBe(403);
    const gesetzt = await t.anfrage(
      "/api/zwei-faktor",
      { method: "PUT", headers: { "content-type": "application/json" }, body: '{"rollen":["mitarbeiter"]}' },
      inhaber,
    );
    expect(await gesetzt.json()).toEqual({ pflicht: ["mitarbeiter"] });
    expect(
      await t.sql`select actor from audit_log where table_name = 'anmeldung_einstellungen'
      order by seq desc limit 1`,
    ).toEqual([{ actor: "nutzer:anna@example.org" }]);

    const res = await t.anfrage("/api/dokumente", {}, zugang);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ zweiFaktorEinrichten: true });
    expect(await (await t.anfrage("/api/ich", {}, zugang)).json()).toMatchObject({ zweiFaktorEinrichten: true });
    expect(await (await t.anfrage("/api/konto", {}, zugang)).json()).toMatchObject({ pflicht: true, einrichten: true });
    // Der Inhaber ist nicht betroffen
    expect((await t.anfrage("/api/dokumente", {}, inhaber)).status).toBe(200);

    const { cookie } = await totpEinrichten(zugang);
    expect((await t.anfrage("/api/dokumente", {}, cookie)).status).toBe(200);
    expect(await (await t.anfrage("/api/ich", {}, cookie)).json()).not.toHaveProperty("zweiFaktorEinrichten");
    // Die Verfahrensdokumentation nennt Pflicht und zweiten Faktor je Zugang
    const doku = JSON.stringify(await (await t.anfrage("/api/verfahrensdoku", {}, inhaber)).json());
    expect(doku).toContain("Ein zweiter Faktor ist Pflicht für: Mitarbeiter");
    expect(doku).toMatch(/mia@example\.org: Mitarbeiter, [^"]*, zweiter Faktor: TOTP"/);

    await t.anfrage(
      "/api/zwei-faktor",
      { method: "PUT", headers: { "content-type": "application/json" }, body: '{"rollen":[]}' },
      inhaber,
    );
  });

  it("setzt als Inhaber den zweiten Faktor eines anderen Zugangs zurück, mit Audit, nie den eigenen", async () => {
    const zugang = await zugangAnlegen(t, inhaber, "verlust@example.org", { rolle: "steuerberatung" });
    const { cookie } = await totpEinrichten(zugang);
    const [{ id }] = (await t.sql`select id from "user" where email = 'verlust@example.org'`) as unknown as [
      { id: string },
    ];
    const liste = (await (await t.anfrage("/api/zugaenge", {}, inhaber)).json()) as {
      zugaenge: { email: string; zweiFaktor: { totp: boolean } }[];
    };
    expect(liste.zugaenge.find((z) => z.email === "verlust@example.org")?.zweiFaktor).toEqual({
      totp: true,
      passkeys: 0,
    });
    // Andere Rollen dürfen das nicht
    expect((await post(`/api/zugaenge/${id}/zwei-faktor-zuruecksetzen`, {}, cookie)).status).toBe(403);
    const [{ id: eigen }] = (await t.sql`select id from "user" where role = 'inhaber'`) as unknown as [{ id: string }];
    expect((await post(`/api/zugaenge/${eigen}/zwei-faktor-zuruecksetzen`, {}, inhaber)).status).toBe(400);

    expect((await post(`/api/zugaenge/${id}/zwei-faktor-zuruecksetzen`, {}, inhaber)).status).toBe(200);
    expect(await t.sql`select 1 from two_factor where user_id = ${id}`).toHaveLength(0);
    // Seine Sitzungen enden
    expect((await t.anfrage("/api/ich", {}, cookie)).status).toBe(401);
    const protokoll = await t.sql`select actor, action from audit_log
      where table_name = 'two_factor' and row_id = (select row_id from audit_log where table_name = 'two_factor'
        and new_value->>'user_id' = ${id} limit 1) order by seq`;
    expect(protokoll.at(-1)).toEqual({ actor: "nutzer:anna@example.org", action: "DELETE" });
    // Danach meldet er sich wieder nur mit dem Passwort an
    expect(await (await anmelden("verlust@example.org")).json()).not.toHaveProperty("twoFactorRedirect");
  });
});

describe.skipIf(!testDatenbankUrl)("Grenzen für den zweiten Schritt", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => {
    t = await testApp({ begrenzen: true, clientIp: () => "203.0.113.7" });
  });
  afterAll(() => t?.aufraeumen());

  it("lehnt falsche Codes ab und begrenzt die Versuche", async () => {
    const inhaber = (await t.registrieren("anna@example.org")).cookie;
    const post = (pfad: string, body: unknown, cookie?: string) =>
      t.anfrage(
        pfad,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        cookie,
      );
    const { totpURI } = (await (
      await post("/api/auth/two-factor/enable", { password: "ein-langes-passwort" }, inhaber)
    ).json()) as { totpURI: string };
    const geheimnis = geheimnisAus(totpURI);
    expect((await post("/api/auth/two-factor/verify-totp", { code: totpCode(geheimnis) }, inhaber)).status).toBe(200);
    const anmeldung = await post("/api/auth/sign-in/email", {
      email: "anna@example.org",
      password: "ein-langes-passwort",
    });
    const halb = cookiesAus(anmeldung);
    const richtig = totpCode(geheimnis);
    const falsch = String((Number(richtig) + 500_000) % 1_000_000).padStart(6, "0");
    const status: number[] = [];
    for (let i = 0; i < 6; i++)
      status.push((await post("/api/auth/two-factor/verify-totp", { code: falsch }, halb)).status);
    expect(status[0]).toBe(401);
    expect(status).toContain(429);
    // Auch der richtige Code hilft dann nicht sofort weiter
    expect((await post("/api/auth/two-factor/verify-totp", { code: richtig }, halb)).status).not.toBe(200);
  });
});
