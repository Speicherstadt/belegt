import type { AddressInfo } from "node:net";
import PostalMime from "postal-mime";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kettePruefen } from "../pruefung/kette.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { benachrichtigen, type Umgebung } from "./benachrichtigen.ts";
import { mailAusEnv, smtpVersender } from "./versand.ts";

/*
 * Benachrichtigungen gegen Postgres und einen nachgebauten SMTP-Server (smtp-server): jede Art auslösen, entprellen,
 * keine Inhalte von Dokumenten, kein Versand ohne Einstellung.
 */

interface Empfangen {
  an: string[];
  betreff: string;
  text: string;
  benutzer?: string;
}

const PASSWORT = "smtp-geheimnis-42";

async function smtpAttrappe() {
  const post: Empfangen[] = [];
  const server = new SMTPServer({
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    authOptional: false,
    logger: false,
    onAuth: (auth, _s, fertig) =>
      auth.username === "belegt" && auth.password === PASSWORT
        ? fertig(null, { user: auth.username })
        : fertig(new Error("Anmeldung abgelehnt")),
    onData(stream, sitzung, fertig) {
      const teile: Buffer[] = [];
      stream.on("data", (b: Buffer) => teile.push(b));
      stream.on("end", async () => {
        const mail = await PostalMime.parse(Buffer.concat(teile));
        post.push({
          an: sitzung.envelope.rcptTo.map((r) => r.address),
          betreff: mail.subject ?? "",
          text: mail.text ?? "",
          benutzer: sitzung.user as string | undefined,
        });
        fertig();
      });
    },
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.server.address() as AddressInfo).port;
  return { post, port, schliessen: () => new Promise<void>((ok) => server.close(() => ok())) };
}

describe("Versand aus der Umgebung", () => {
  it("schickt ohne MAIL_SMTP_URL nichts und nimmt den Absender aus BETTER_AUTH_URL", () => {
    expect(mailAusEnv({ BETTER_AUTH_URL: "https://belegt.firma.de" })).toBeUndefined();
    expect(
      mailAusEnv({ MAIL_SMTP_URL: "smtp://belegt@mail.firma.de:587", BETTER_AUTH_URL: "https://belegt.firma.de" })
        ?.absender,
    ).toBe("belegt@belegt.firma.de");
  });
});

describe.skipIf(!testDatenbankUrl)("Benachrichtigungen gegen Postgres und SMTP", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let smtp: Awaited<ReturnType<typeof smtpAttrappe>>;
  let u: Umgebung;
  let inhaber: string;
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const lage = (stunden = 0) => ({ jetzt: new Date(Date.now() + stunden * 3_600_000), heute });
  const json = (methode: string, body: unknown) => ({
    method: methode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const alleAn = {
    backup: { an: true, tage: 2 },
    postfach: { an: true, tage: 1 },
    kette: { an: true },
    loeschung: { an: true },
    fristen: { an: true },
    eingang: { an: true, anzahl: 1 },
    workflow: { an: true },
  };
  async function hochladen(name: string, text: string) {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(`%PDF-1.7\n% ${text}\n`)], name));
    return (await (await t.anfrage("/api/dokumente", { method: "POST", body: form }, inhaber)).json()) as {
      id: string;
    };
  }

  beforeAll(async () => {
    smtp = await smtpAttrappe();
    const versender = smtpVersender({
      url: `smtp://belegt@127.0.0.1:${smtp.port}?tls=nein`,
      passwort: PASSWORT,
      absender: "belegt@belegt.example",
    });
    t = await testApp({ mail: { versender, absender: "belegt@belegt.example" } });
    u = { db: t.db, versender, basisUrl: "http://localhost:3000" };
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await smtp?.schliessen();
  });
  beforeEach(() => {
    smtp.post.length = 0;
  });

  it("verwaltet die Einstellungen nur als Inhaber und schickt eine Testmail", async () => {
    const kanzlei = await zugangAnlegen(t, inhaber, "kanzlei@example.org", { rolle: "steuerberatung" });
    expect((await t.anfrage("/api/benachrichtigungen", {}, kanzlei)).status).toBe(403);
    const stand = await (await t.anfrage("/api/benachrichtigungen", {}, inhaber)).json();
    expect(stand).toMatchObject({ eingerichtet: true, absender: "belegt@belegt.example", gesendet: [] });
    expect(stand.einstellungen.anlaesse.eingang).toEqual({ an: false, anzahl: 50 });
    // Adresse und Passwort des SMTP-Servers nennt keine Antwort
    expect(JSON.stringify(stand)).not.toContain(PASSWORT);
    expect(JSON.stringify(stand)).not.toContain(String(smtp.port));

    const ungueltig = await t.anfrage(
      "/api/benachrichtigungen",
      json("PUT", { anlaesse: alleAn, anInhaber: true, weitereEmpfaenger: ["keine-adresse"] }),
      inhaber,
    );
    expect(ungueltig.status).toBe(400);
    const gespeichert = await t.anfrage(
      "/api/benachrichtigungen",
      json("PUT", { anlaesse: alleAn, anInhaber: true, weitereEmpfaenger: ["IT@example.org"] }),
      inhaber,
    );
    expect(await gespeichert.json()).toMatchObject({ weitereEmpfaenger: ["it@example.org"] });
    expect(
      await t.sql`select actor from audit_log where table_name = 'benachrichtigung_einstellungen' order by seq desc limit 1`,
    ).toEqual([{ actor: "nutzer:anna@example.org" }]);

    const test = await t.anfrage("/api/benachrichtigungen/test", { method: "POST" }, inhaber);
    expect(await test.json()).toEqual({ empfaenger: ["anna@example.org", "it@example.org"] });
    expect(smtp.post).toEqual([
      expect.objectContaining({
        an: ["anna@example.org", "it@example.org"],
        betreff: "Belegt: Testmail",
        benutzer: "belegt",
      }),
    ]);
    expect(smtp.post[0]!.text).toContain("http://localhost:3000/benachrichtigungen");
    const protokoll = (await (await t.anfrage("/api/benachrichtigungen", {}, inhaber)).json()).gesendet;
    expect(protokoll).toEqual([expect.objectContaining({ anlass: "test", ok: true, betreff: "Belegt: Testmail" })]);
  });

  it("meldet jede Art, an die Richtigen und ohne Inhalte von Dokumenten, und entprellt", async () => {
    // Backup fehlgeschlagen; den Stand schreibt sonst der Backup-Container als Eigentümer
    await t.sql`insert into backup_status (am, art, ok, meldung) values (now() - interval '3 days', 'backup', true, ''),
      (now() - interval '1 hour', 'backup', false, 'restic: Repository nicht erreichbar')`;
    // Postfach seit Tagen nicht abgerufen
    await t.sql`insert into quellen (name, host, benutzer, ciphertext, erstellt_am, letzter_fehler)
      values ('Rechnungen', 'imap.example.org', 'r', '\\x00', now() - interval '3 days', 'Anmeldung abgelehnt')`;
    // Eine Aktion im Postfach (verschieben) ist fehlgeschlagen; die Mail dazu ohne echtes .eml, an den Triggern vorbei
    const mail = await hochladen("mail.eml", "mail");
    await t.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`with q as (select id from quellen where name = 'Rechnungen'),
        m as (insert into postfach_mails (quelle_id, dokument_id, sha256, ordner, uid_validity, uid, archiviert_am)
              select q.id, ${mail.id}, 'x', 'INBOX', 1, 1, now() from q returning id, quelle_id)
        insert into postfach_aktionen (postfach_mail_id, quelle_id, dokument_id, aktion, ordner, ergebnis, meldung)
        select m.id, m.quelle_id, ${mail.id}, 'verschieben', 'INBOX', 'fehler', 'Ordner fehlt' from m`;
    });
    // Löschantrag der Inhaberin: wartet auf die Steuerberatung, nicht auf sie selbst
    const alt = await hochladen("vertrag-mueller-geheim.pdf", "Geheimer Vertragstext");
    await t.anfrage(
      `/api/dokumente/${alt.id}/einordnung`,
      json("POST", { art: "beleg", entstanden: "2010-03-01", titel: "Vertrag Müller vertraulich" }),
      inhaber,
    );
    expect((await t.anfrage(`/api/dokumente/${alt.id}/loeschung`, { method: "POST" }, inhaber)).status).toBe(201);
    // Frist in den nächsten 30 Tagen
    const bald = await hochladen("frist-bald.pdf", "bald");
    const in10 = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await t.anfrage(
      `/api/dokumente/${bald.id}/einordnung`,
      json("POST", { art: "freiwillig", entstanden: heute, freiwilligBis: in10, titel: "Titel bleibt intern" }),
      inhaber,
    );
    // Eingang über der Schwelle (1): zwei offene Dokumente
    await hochladen("offen-1.pdf", "eins");
    await hochladen("offen-2.pdf", "zwei");
    // Ein fehlgeschlagener Workflow
    await t.sql`insert into workflow_laeufe (workflow_id, workflow_name, dokument_id, ausloeser, ergebnis, fehler)
      values (gen_random_uuid(), 'Stromrechnungen', ${bald.id}, 'eingang', 'fehler', 'Tag fehlt')`;
    // Und eine Weitergabe, bei der Belegt aufgegeben hat
    await t.sql`insert into weitergaben (workflow_id, workflow_name, position, dokument_id, stand, versuche, letzter_versuch, fehler)
      values (gen_random_uuid(), 'An Buchhaltung', 0, ${bald.id}, 'fehlgeschlagen', 1, now(), 'Antwort 401')`;
    // Ein Befund in der Kette: eine Zeile an den Triggern vorbei geändert (braucht einen Superuser)
    await t.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update dokumente set dateiname = 'gefaelscht.pdf' where id = ${bald.id}`;
    });
    // Gemeldet wird der letzte gespeicherte Lauf der Prüfung, nicht eine eigene
    await kettePruefen(t.db, "system:worker");

    const ergebnis = await benachrichtigen(u, lage());
    const betreffe = smtp.post.map((m) => m.betreff).sort();
    expect(betreffe).toEqual(
      [
        "Belegt: 1 Frist endet in den nächsten 30 Tagen",
        "Belegt: 1 Löschantrag wartet auf dich",
        "Belegt: 2 Workflow-Läufe fehlgeschlagen",
        "Belegt: 3 Dokumente im Eingang",
        "Belegt: Aktion im Postfach „Rechnungen“ fehlgeschlagen",
        "Belegt: keine aktuelle Sicherung",
        "Belegt: Postfach „Rechnungen“ nicht abgerufen",
        "Belegt: Prüfung der Kette mit Befund",
        "Belegt: Sicherung fehlgeschlagen",
      ].sort(),
    );
    expect(ergebnis).toEqual({ gesendet: 9, fehler: 0, entprellt: 0 });
    const an = (betreff: string) => smtp.post.find((m) => m.betreff.includes(betreff))!.an;
    expect(an("Löschantrag")).toEqual(["kanzlei@example.org"]);
    expect(an("Sicherung")).toEqual(["anna@example.org", "it@example.org"]);
    // Zahlen, Namen von Postfach und Workflow, Archivnummern und Links; keine Inhalte
    const alles = smtp.post.map((m) => `${m.betreff}\n${m.text}`).join("\n");
    for (const inhalt of [
      "vertrag-mueller",
      "Vertrag Müller",
      "Geheimer",
      "Titel bleibt intern",
      "frist-bald",
      "offen-1",
    ])
      expect(alles).not.toContain(inhalt);
    expect(alles).toMatch(/ASN \d+/);
    expect(alles).toContain("http://localhost:3000/fristen");
    // Eine freiwillige Frist (etwa eine Garantie) ist eine Erinnerung, kein Hinweis aufs Löschen
    const fristMail = smtp.post.find((m) => m.betreff.includes("Frist"))!.text;
    expect(fristMail).toContain("Freiwillige Frist, etwa Garantie oder Kündigung");
    expect(fristMail).not.toContain("Danach lassen sie sich löschen");
    expect(alles).toContain("Stromrechnungen");
    expect(alles).not.toContain(PASSWORT);

    // Gleicher Zustand: nicht noch einmal, auch nicht nach 23 Stunden
    expect(await benachrichtigen(u, lage(23))).toEqual({ gesendet: 0, fehler: 0, entprellt: 9 });
    expect(smtp.post).toHaveLength(9);
    // Nach einem Tag erinnert Belegt an, was noch gilt; die Fristen kommen erst nach einer Woche wieder
    smtp.post.length = 0;
    await benachrichtigen(u, lage(25));
    expect(smtp.post.map((m) => m.betreff)).not.toContain("Belegt: 1 Frist endet in den nächsten 30 Tagen");
    expect(smtp.post.length).toBeGreaterThan(0);
    // Ein neuer Zustand geht sofort hinaus: ein zweiter Fehlschlag der Sicherung
    smtp.post.length = 0;
    await t.sql`insert into backup_status (art, ok, meldung) values ('restore_check', false, 'Prüfung mit Befunden')`;
    await benachrichtigen(u, lage(25));
    expect(smtp.post.map((m) => m.betreff)).toEqual(["Belegt: Test-Restore fehlgeschlagen"]);

    // Das Protokoll wächst nur an und steht im Audit-Log
    const [eintrag] = await t.sql`select id from benachrichtigungen order by id limit 1`;
    await expect(t.sql`update benachrichtigungen set ok = false where id = ${eintrag!.id}`).rejects.toThrow();
    await expect(t.sql`delete from benachrichtigungen`).rejects.toThrow();
    expect(
      (await t.sql`select count(*)::int as n from audit_log where table_name = 'benachrichtigungen'`)[0],
    ).toMatchObject({ n: expect.any(Number) });
  });

  it("schickt nichts für ausgeschaltete Anlässe und protokolliert einen gescheiterten Versand", async () => {
    await t.anfrage(
      "/api/benachrichtigungen",
      json("PUT", {
        anlaesse: Object.fromEntries(Object.entries(alleAn).map(([k, v]) => [k, { ...v, an: false }])),
        anInhaber: true,
        weitereEmpfaenger: [],
      }),
      inhaber,
    );
    expect(await benachrichtigen(u, lage(200))).toEqual({ gesendet: 0, fehler: 0, entprellt: 0 });
    expect(smtp.post).toEqual([]);

    // Falsches Passwort: der Versuch steht mit Fehler im Protokoll, das Passwort nirgends
    await t.anfrage(
      "/api/benachrichtigungen",
      json("PUT", { anlaesse: alleAn, anInhaber: true, weitereEmpfaenger: [] }),
      inhaber,
    );
    const falsch = smtpVersender({
      url: `smtp://belegt@127.0.0.1:${smtp.port}?tls=nein`,
      passwort: "falsches-geheimnis",
      absender: "belegt@belegt.example",
    });
    const r = await benachrichtigen({ ...u, versender: falsch }, lage(400));
    expect(r.fehler).toBeGreaterThan(0);
    const fehler = await t.sql`select fehler from benachrichtigungen where not ok`;
    expect(fehler.length).toBe(r.fehler);
    expect(JSON.stringify(fehler)).not.toContain("falsches-geheimnis");
    // Nach einem Fehlschlag frühestens nach einer Stunde wieder
    expect((await benachrichtigen({ ...u, versender: falsch }, lage(400.5))).fehler).toBe(0);
  });
});

describe.skipIf(!testDatenbankUrl)("Ohne Versand", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => {
    t = await testApp();
  });
  afterAll(() => t?.aufraeumen());

  it("meldet, dass nichts eingerichtet ist, und schickt keine Testmail", async () => {
    const { cookie } = await t.registrieren("anna@example.org");
    expect(await (await t.anfrage("/api/benachrichtigungen", {}, cookie)).json()).toMatchObject({
      eingerichtet: false,
      absender: null,
    });
    expect((await t.anfrage("/api/benachrichtigungen/test", { method: "POST" }, cookie)).status).toBe(503);
    expect(await t.sql`select 1 from benachrichtigungen`).toHaveLength(0);
  });
});
