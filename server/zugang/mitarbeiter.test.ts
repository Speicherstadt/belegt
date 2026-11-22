import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { tokenAnlegen, zugangAnlegen } from "../test-zugaenge.ts";
import { mitarbeiterDarf } from "./mitarbeiter.ts";

describe("Mitarbeiter ohne Datenbank", () => {
  it("lässt mit dem Recht lesen nur Lesendes zu, mit bearbeiten auch Aufnehmen, Einordnen, Ordnung und Notizen", () => {
    expect(mitarbeiterDarf("lesen", "GET", "/api/dokumente/abc/datei")).toBe(true);
    expect(mitarbeiterDarf("lesen", "POST", "/api/dokumente")).toBe(false);
    expect(mitarbeiterDarf("lesen", "POST", "/api/dokumente/abc/notizen")).toBe(false);
    expect(mitarbeiterDarf("lesen", "GET", "/api/dokumente/abc/vorschlag")).toBe(false);
    expect(mitarbeiterDarf("bearbeiten", "POST", "/api/dokumente")).toBe(true);
    expect(mitarbeiterDarf("bearbeiten", "POST", "/api/dokumente/abc/ordnung")).toBe(true);
    expect(mitarbeiterDarf("bearbeiten", "POST", "/api/dokumente/abc/seiten")).toBe(false);
    expect(mitarbeiterDarf("bearbeiten", "POST", "/api/dokumente/abc/links")).toBe(false);
    expect(mitarbeiterDarf("bearbeiten", "GET", "/api/export")).toBe(false);
    expect(mitarbeiterDarf("bearbeiten", "POST", "/api/tags")).toBe(false);
  });
});

describe.skipIf(!testDatenbankUrl)("Mitarbeiter gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown, method = "POST"): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ids = async (cookie: string, pfad = "/api/dokumente") =>
    ((await (await als(cookie)(pfad)).json()) as { id: string }[]).map((d) => d.id).sort();

  async function hoch(cookie: string, name: string) {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(`%PDF-1.7\n% ${name}\n`)], `${name}.pdf`));
    const res = await als(cookie)("/api/dokumente", { method: "POST", body: form });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }
  async function ordnen(id: string, aenderung: Record<string, unknown>, cookie = inhaber) {
    return als(cookie)(`/api/dokumente/${id}/ordnung`, json(aenderung));
  }
  async function anlegen(pfad: string, name: string) {
    return ((await (await als(inhaber)(pfad, json({ name }))).json()) as { id: string }).id;
  }

  let personal: string;
  let projekt: string;
  let rechnung: string;
  let stadtwerke: string;
  /** Tag Projekt X und Typ Eingangsrechnung */
  let beides: string;
  let nurTag: string;
  let nurTyp: string;
  /** Projekt X, Eingangsrechnung und Personal */
  let geheim: string;
  let ohne: string;
  let vonStadtwerken: string;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    personal = await anlegen("/api/tags", "Personal");
    projekt = await anlegen("/api/tags", "Projekt X");
    rechnung = await anlegen("/api/dokumenttypen", "Eingangsrechnung");
    stadtwerke = await anlegen("/api/korrespondenten", "Stadtwerke");
    beides = await hoch(inhaber, "beides-strom");
    nurTag = await hoch(inhaber, "nur-tag");
    nurTyp = await hoch(inhaber, "nur-typ");
    geheim = await hoch(inhaber, "geheim-gehalt");
    ohne = await hoch(inhaber, "ohne-ordnung");
    vonStadtwerken = await hoch(inhaber, "stadtwerke-abschlag");
    await ordnen(beides, { tagsHinzu: [projekt], dokumenttyp: rechnung });
    await ordnen(nurTag, { tagsHinzu: [projekt] });
    await ordnen(nurTyp, { dokumenttyp: rechnung });
    await ordnen(geheim, { tagsHinzu: [projekt, personal], dokumenttyp: rechnung });
    await ordnen(vonStadtwerken, { korrespondent: stadtwerke });
  });
  afterAll(() => t?.aufraeumen());

  it("verlangt für einen Mitarbeiter Recht und Sichtbereich", async () => {
    expect((await als(inhaber)("/api/einladungen", json({ rolle: "mitarbeiter" }))).status).toBe(400);
    expect(
      (
        await als(inhaber)(
          "/api/einladungen",
          json({ rolle: "mitarbeiter", recht: "alles", sichtbereich: { tags: [projekt] } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await als(inhaber)(
          "/api/einladungen",
          json({ rolle: "mitarbeiter", recht: "lesen", sichtbereich: { tags: ["x"] } }),
        )
      ).status,
    ).toBe(400);
    await expect(
      t.sql`insert into einladungen (token_hash, rolle, gueltig_bis) values ('x', 'mitarbeiter', now())`,
    ).rejects.toThrow(/einladungen_mitarbeiter/);
  });

  it("zeigt nach Tag UND Typ, ohne den ausgeschlossenen Tag", async () => {
    const m = await zugangAnlegen(t, inhaber, "tag-typ@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [projekt], dokumenttypen: [rechnung], ohneTags: [personal] },
    });
    expect(await ids(m)).toEqual([beides]);
    expect((await als(m)(`/api/dokumente/${beides}`)).status).toBe(200);
    for (const id of [nurTag, nurTyp, geheim, ohne, vonStadtwerken])
      expect((await als(m)(`/api/dokumente/${id}`)).status).toBe(404);
    const ich = await (await als(m)("/api/ich")).json();
    expect(ich).toMatchObject({ role: "mitarbeiter", recht: "lesen", sichtbereich: { tags: [projekt] } });
  });

  it("zeigt alles außer dem ausgeschlossenen Tag", async () => {
    const m = await zugangAnlegen(t, inhaber, "ohne-personal@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { ohneTags: [personal] },
    });
    expect(await ids(m)).toEqual([beides, nurTag, nurTyp, ohne, vonStadtwerken].sort());
  });

  it("zeigt nach Korrespondent und, auf Wunsch, Dokumente ohne Ordnung", async () => {
    const k = await zugangAnlegen(t, inhaber, "korrespondent@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { korrespondenten: [stadtwerke] },
    });
    expect(await ids(k)).toEqual([vonStadtwerken]);
    const o = await zugangAnlegen(t, inhaber, "ohne@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [projekt], ohneOrdnung: true },
    });
    expect(await ids(o)).toEqual([beides, nurTag, geheim, ohne].sort());
  });

  it("verrät in Zahlen, Suche, Ordnung und ähnlichen Dokumenten nichts außerhalb", async () => {
    const m = await zugangAnlegen(t, inhaber, "zahlen@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [projekt], ohneTags: [personal] },
    });
    // Startseite: nur die beiden sichtbaren, ohne Fristen, Sperren, Quellen und Speicher
    const start = await (await als(m)("/api/start")).json();
    expect(start).toEqual({ eingang: 2, gesamt: 2, diesesJahr: 2, vorjahr: 0, verlauf: [...Array(11).fill(0), 2] });
    // Suche nach einem Wort aus einem unsichtbaren Dateinamen: nichts, auch nicht in der Gesamtzahl
    const suche = await als(m)("/api/dokumente?suche=gehalt");
    expect(await suche.json()).toEqual([]);
    expect(suche.headers.get("x-gesamt")).toBe("0");
    expect((await als(inhaber)("/api/dokumente?suche=gehalt")).headers.get("x-gesamt")).toBe("1");
    // Tags: Personal fehlt, Projekt X zählt nur die sichtbaren; Typ und Korrespondent ebenso
    const tags = (await (await als(m)("/api/tags")).json()) as { id: string; anzahl: number }[];
    expect(tags.map((x) => [x.id, x.anzahl])).toEqual([[projekt, 2]]);
    const typen = (await (await als(m)("/api/dokumenttypen")).json()) as { id: string; anzahl: number }[];
    expect(typen.map((x) => [x.id, x.anzahl])).toEqual([[rechnung, 1]]);
    const korrespondenten = (await (await als(m)("/api/korrespondenten")).json()) as { anzahl: number }[];
    expect(korrespondenten.map((x) => x.anzahl)).toEqual([0]);
    const aehnlich = (await (await als(m)(`/api/dokumente/${beides}/aehnliche`)).json()) as { id: string }[];
    expect(aehnlich.map((x) => x.id).every((id) => id === nurTag)).toBe(true);
    expect(await (await als(m)(`/api/dokumente/${beides}/ableitungen`)).json()).toEqual({ aus: [], daraus: [] });
  });

  it("lehnt mit dem Recht lesen jede Änderung ab, mit bearbeiten nicht", async () => {
    const leser = await zugangAnlegen(t, inhaber, "leser@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [projekt] },
    });
    expect((await als(leser)(`/api/dokumente/${nurTag}/notizen`)).status).toBe(200);
    for (const [pfad, body] of [
      [`/api/dokumente/${nurTag}/einordnung`, { art: "beleg", entstanden: "2024-01-01" }],
      [`/api/dokumente/${nurTag}/ordnung`, { dokumenttyp: rechnung }],
      [`/api/dokumente/${nurTag}/notizen`, { text: "Hallo" }],
    ] as const)
      expect((await als(leser)(pfad, json(body))).status).toBe(403);
    const form = new FormData();
    form.append("datei", new File(["x"], "x.txt"));
    expect((await als(leser)("/api/dokumente", { method: "POST", body: form })).status).toBe(403);

    const bearbeiter = await zugangAnlegen(t, inhaber, "bearbeiter@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt] },
    });
    expect(
      (await als(bearbeiter)(`/api/dokumente/${nurTag}/einordnung`, json({ art: "beleg", entstanden: "2024-01-01" })))
        .status,
    ).toBe(201);
    expect((await ordnen(nurTag, { korrespondent: stadtwerke }, bearbeiter)).status).toBe(200);
    expect((await als(bearbeiter)(`/api/dokumente/${nurTag}/notizen`, json({ text: "Geprüft" }))).status).toBe(201);
    expect((await als(bearbeiter)(`/api/dokumente/${nurTag}/vorschlag`)).status).toBe(200);
    await ordnen(nurTag, { korrespondent: null });
  });

  it("verhindert, dass ein Mitarbeiter ein Dokument aus seinem Sichtbereich schiebt", async () => {
    const m = await zugangAnlegen(t, inhaber, "schieber@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt], dokumenttypen: [rechnung], ohneTags: [personal] },
    });
    const weg = await ordnen(beides, { tagsWeg: [projekt] }, m);
    expect(weg.status).toBe(409);
    expect((await weg.json()).fehler).toMatch(/außerhalb deines Sichtbereichs/);
    expect((await ordnen(beides, { tagsHinzu: [personal] }, m)).status).toBe(409);
    expect((await ordnen(beides, { dokumenttyp: null }, m)).status).toBe(409);
    // Alles zurückgerollt: das Dokument hat noch Tag und Typ
    const d = await (await als(inhaber)(`/api/dokumente/${beides}`)).json();
    expect(d.tags.map((x: { id: string }) => x.id)).toEqual([projekt]);
    expect(d.dokumenttyp.id).toBe(rechnung);
    // Sammelbearbeitung: ein unsichtbares Dokument dabei, oder eines, das danach herausfiele, ändert nichts
    expect((await als(m)("/api/dokumente/sammeln", json({ ids: [beides, nurTag], tagsHinzu: [projekt] }))).status).toBe(
      404,
    );
    expect((await als(m)("/api/dokumente/sammeln", json({ ids: [beides], dokumenttyp: null }))).status).toBe(409);
    // Ein Korrespondent beim Einordnen ist erlaubt, solange das Dokument sichtbar bleibt
    const k = await zugangAnlegen(t, inhaber, "nur-stadtwerke@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { korrespondenten: [stadtwerke] },
    });
    const einordnung = await als(k)(
      `/api/dokumente/${vonStadtwerken}/einordnung`,
      json({ art: "beleg", entstanden: "2024-01-01", korrespondent: "Andere GmbH" }),
    );
    expect(einordnung.status).toBe(409);
    expect(await ids(k)).toEqual([vonStadtwerken]);
  });

  it("legt beim Einordnen keinen neuen Korrespondenten an, nimmt aber einen aus der Liste", async () => {
    // Listen anlegen darf nur der Inhaber (docs/zugaenge.md), auch nicht nebenbei über den Namen in der Einordnung
    const m = await zugangAnlegen(t, inhaber, "neuer-name@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt] },
    });
    const neu = { art: "beleg", entstanden: "2024-01-01", korrespondent: "Erfundene GmbH" };
    expect((await als(m)(`/api/dokumente/${nurTag}/einordnung`, json(neu))).status).toBe(409);
    const sammel = await als(m)(
      "/api/dokumente/sammeln",
      json({ ids: [nurTag], einordnung: { ...neu, nurOffene: false } }),
    );
    expect(sammel.status).toBe(409);
    expect(await t.sql`select 1 from korrespondenten where name = 'Erfundene GmbH'`).toHaveLength(0);
    const vorhanden = { art: "beleg", entstanden: "2024-01-01", korrespondent: "stadtwerke" };
    expect((await als(m)(`/api/dokumente/${nurTag}/einordnung`, json(vorhanden))).status).toBe(201);
    await ordnen(nurTag, { korrespondent: null });
  });

  it("nennt in Vorschlägen keine Tags, Typen und Korrespondenten außerhalb seines Sichtbereichs", async () => {
    const m = await zugangAnlegen(t, inhaber, "vorschlag@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt], ohneTags: [personal] },
    });
    // Eine Zuordnungsregel schlägt für ein sichtbares Dokument auch den ausgeschlossenen Tag vor
    const vorschlag = { korrespondent: null, dokumenttyp: null, tags: [personal, projekt], uebersprungen: [] };
    await t.sql`insert into zuordnung_vorschlaege (dokument_id, vorschlag) values (${nurTag}, ${JSON.stringify(vorschlag)}::jsonb)`;
    try {
      const v = (await (await als(m)(`/api/dokumente/${nurTag}/vorschlag`)).json()) as {
        zuordnung: { tags: { name: string }[] } | null;
      };
      expect(v.zuordnung?.tags.map((x) => x.name)).toEqual(["Projekt X"]);
      // Der Inhaber sieht beide
      const alle = (await (await als(inhaber)(`/api/dokumente/${nurTag}/vorschlag`)).json()) as typeof v;
      expect(alle.zuordnung?.tags.map((x) => x.name)).toEqual(["Personal", "Projekt X"]);
    } finally {
      await t.sql`delete from zuordnung_vorschlaege where dokument_id = ${nurTag}`;
    }
  });

  it("behält nach dem Zusammenführen von Korrespondenten den Sichtbereich", async () => {
    const alt = await anlegen("/api/korrespondenten", "Stadtwerke GmbH");
    const doppelt = await hoch(inhaber, "stadtwerke-doppelt");
    await ordnen(doppelt, { korrespondent: alt });
    const m = await zugangAnlegen(t, inhaber, "zusammen@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { korrespondenten: [alt] },
    });
    const einladung = await als(inhaber)(
      "/api/einladungen",
      json({ rolle: "mitarbeiter", recht: "lesen", sichtbereich: { korrespondenten: [alt, stadtwerke] } }),
    );
    expect(einladung.status).toBe(201);
    expect(await ids(m)).toEqual([doppelt]);
    const r = await als(inhaber)(`/api/korrespondenten/${alt}/zusammenfuehren`, json({ ziel: stadtwerke }));
    expect(r.status).toBe(200);
    // Die Dokumente von „Stadtwerke GmbH“ heißen jetzt „Stadtwerke“; der Mitarbeiter sieht sie weiter, dazu die übrigen
    expect(await ids(m)).toEqual([doppelt, vonStadtwerken].sort());
    const [e] = await t.sql`select sichtbereich from einladungen where id = ${(await einladung.json()).id}`;
    expect(e?.sichtbereich.korrespondenten).toEqual([stadtwerke]);
  });

  it("lässt ein eigenes Dokument sichtbar, bis es eine Ordnung außerhalb bekommt", async () => {
    const m = await zugangAnlegen(t, inhaber, "hochlader@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt], dokumenttypen: [rechnung] },
    });
    const anderer = await zugangAnlegen(t, inhaber, "kollege@example.org", {
      rolle: "mitarbeiter",
      recht: "bearbeiten",
      sichtbereich: { tags: [projekt], dokumenttypen: [rechnung] },
    });
    const neu = await hoch(m, "frisch-gescannt");
    expect(await ids(m)).toContain(neu);
    expect((await als(m)(`/api/dokumente/${neu}/datei`)).status).toBe(200);
    // Nur für ihn, nicht für andere Mitarbeiter mit demselben Sichtbereich
    expect((await als(anderer)(`/api/dokumente/${neu}`)).status).toBe(404);
    // Ein Tag allein reicht nicht für seinen Sichtbereich: abgelehnt, das Dokument bleibt ohne Ordnung und sichtbar
    expect((await ordnen(neu, { tagsHinzu: [projekt] }, m)).status).toBe(409);
    expect((await ordnen(neu, { tagsHinzu: [projekt], dokumenttyp: rechnung }, m)).status).toBe(200);
    expect(await ids(anderer)).toContain(neu);
    // Der Inhaber ordnet es um: dann sieht er es nicht mehr
    await ordnen(neu, { dokumenttyp: null });
    expect((await als(m)(`/api/dokumente/${neu}`)).status).toBe(404);
    expect(
      await t.sql`select 1 from audit_log where table_name = 'einlieferungen' and actor = 'nutzer:hochlader@example.org'`,
    ).toHaveLength(1);
  });

  it("ändert Recht und Sichtbereich sofort und mit Eintrag im Audit-Log, und entzieht den Zugang", async () => {
    const m = await zugangAnlegen(t, inhaber, "wechsel@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { korrespondenten: [stadtwerke] },
    });
    const { zugaenge } = await (await als(inhaber)("/api/zugaenge")).json();
    const id = zugaenge.find((z: { email: string }) => z.email === "wechsel@example.org").id as string;
    expect((await als(m)(`/api/zugaenge/${id}`, json({ recht: "bearbeiten", sichtbereich: {} }, "PATCH"))).status).toBe(
      403,
    );
    // Auch kein Programm mit dem Token des Inhabers
    const token = await tokenAnlegen(t, inhaber, "schreiben");
    const mitToken = await t.anfrage(`/api/zugaenge/${id}/entziehen`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mitToken.status).toBe(403);
    const res = await als(inhaber)(
      `/api/zugaenge/${id}`,
      json({ recht: "bearbeiten", sichtbereich: { tags: [projekt] } }, "PATCH"),
    );
    expect(res.status).toBe(200);
    const jetzt = await ids(m);
    expect(jetzt).toEqual(expect.arrayContaining([beides, nurTag, geheim]));
    for (const id of [nurTyp, ohne, vonStadtwerken]) expect(jetzt).not.toContain(id);
    expect((await als(m)(`/api/dokumente/${nurTag}/notizen`, json({ text: "Jetzt darf ich" }))).status).toBe(201);
    const [eintrag] = await t.sql<
      { actor: string; old_value: { recht: string }; new_value: { sichtbereich: { tags: string[] } } }[]
    >`
      select actor, old_value, new_value from audit_log
       where table_name = 'user' and action = 'UPDATE' and row_id = ${id} order by seq desc limit 1`;
    expect(eintrag!.actor).toBe("nutzer:anna@example.org");
    expect(eintrag!.old_value.recht).toBe("lesen");
    expect(eintrag!.new_value.sichtbereich.tags).toEqual([projekt]);
    // Nur Mitarbeiter haben einen Sichtbereich
    const inhaberId = zugaenge.find((z: { email: string }) => z.email === "anna@example.org").id as string;
    expect(
      (await als(inhaber)(`/api/zugaenge/${inhaberId}`, json({ recht: "lesen", sichtbereich: {} }, "PATCH"))).status,
    ).toBe(404);

    expect((await als(inhaber)(`/api/zugaenge/${inhaberId}/entziehen`, { method: "POST" })).status).toBe(404);
    expect((await als(inhaber)(`/api/zugaenge/${id}/entziehen`, { method: "POST" })).status).toBe(200);
    expect((await als(m)("/api/dokumente")).status).toBe(401);
    const anmeldung = await t.anfrage(
      "/api/auth/sign-in/email",
      json({ email: "wechsel@example.org", password: "ein-langes-passwort" }),
    );
    expect(anmeldung.status).toBe(403);
    expect(
      await t.sql`select 1 from audit_log where table_name = 'user' and row_id = ${id} and new_value ->> 'entzogen_am' is not null`,
    ).toHaveLength(1);
  });

  it("lässt Notizen und Mail eines unsichtbaren Dokuments nicht durchscheinen", async () => {
    const eml = [
      "From: Personalabteilung <hr@example.org>",
      "To: anna@example.org",
      "Subject: Gehaltsabrechnung",
      "Message-ID: <gehalt@example.org>",
      'Content-Type: multipart/mixed; boundary="g"',
      "",
      "--g",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Vertraulich.",
      "--g",
      'Content-Type: application/pdf; name="Anhang.pdf"',
      'Content-Disposition: attachment; filename="Anhang.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.7\n% Projektplan\n").toString("base64"),
      "--g--",
      "",
    ].join("\r\n");
    const form = new FormData();
    form.append("datei", new File([eml], "gehalt.eml"));
    const { neu } = await (await als(inhaber)("/api/mails", { method: "POST", body: form })).json();
    const mail = await (await als(inhaber)(`/api/dokumente/${neu[0]}/mail`)).json();
    const anhang = mail.anhaenge[0].dokumentId as string;
    await ordnen(neu[0], { tagsHinzu: [personal] });
    await ordnen(anhang, { tagsHinzu: [projekt] });
    const m = await zugangAnlegen(t, inhaber, "mail@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { ohneTags: [personal] },
    });
    expect((await als(m)(`/api/dokumente/${anhang}`)).status).toBe(200);
    const text = await (await als(m)(`/api/dokumente/${anhang}/mail`)).text();
    expect(text).not.toContain("Gehaltsabrechnung");
    expect(text).not.toContain("Vertraulich");
    expect((await als(m)(`/api/dokumente/${neu[0]}/notizen`)).status).toBe(404);
  });

  it("zeigt Mail und Anhänge nur gemeinsam: keine .eml mit unsichtbarem Anhang, kein Mailtext in der Suche", async () => {
    const mailMit = async (betreff: string, id: string, anhang: string) => {
      const eml = [
        "From: Absender <a@example.org>",
        "To: anna@example.org",
        `Subject: ${betreff}`,
        `Message-ID: <${id}@example.org>`,
        'Content-Type: multipart/mixed; boundary="g"',
        "",
        "--g",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Text.",
        "--g",
        `Content-Type: application/pdf; name="${anhang}.pdf"`,
        `Content-Disposition: attachment; filename="${anhang}.pdf"`,
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(`%PDF-1.7\n% ${anhang}\n`).toString("base64"),
        "--g--",
        "",
      ].join("\r\n");
      const form = new FormData();
      form.append("datei", new File([eml], `${id}.eml`));
      const { neu } = await (await als(inhaber)("/api/mails", { method: "POST", body: form })).json();
      const m = await (await als(inhaber)(`/api/dokumente/${neu[0]}/mail`)).json();
      return { mail: neu[0] as string, anhang: m.anhaenge[0].dokumentId as string };
    };
    const suche = async (cookie: string, wort: string) =>
      ids(cookie, `/api/dokumente?suche=${encodeURIComponent(wort)}`);

    // Mail sichtbar, Anhang ausgeschlossen: die .eml enthielte den Anhang, also gibt es die Mail nicht
    const a = await mailMit("Projektbesprechung", "projekt-mail", "Lohnzettel");
    await ordnen(a.mail, { tagsHinzu: [projekt] });
    await ordnen(a.anhang, { tagsHinzu: [projekt, personal] });
    const m = await zugangAnlegen(t, inhaber, "mail-gemeinsam@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [projekt], ohneTags: [personal] },
    });
    for (const pfad of [`/api/dokumente/${a.mail}`, `/api/dokumente/${a.mail}/datei`, `/api/dokumente/${a.mail}/mail`])
      expect((await als(m)(pfad)).status).toBe(404);
    expect(await suche(m, "Projektbesprechung")).toEqual([]);

    // Anhang sichtbar, Mail ausgeschlossen: Betreff und Absender der Mail finden den Anhang nicht, sein Name schon
    const b = await mailMit("Kuendigungsschreiben", "kuendigung-mail", "Bauplan");
    await ordnen(b.mail, { tagsHinzu: [projekt, personal] });
    await ordnen(b.anhang, { tagsHinzu: [projekt] });
    expect((await als(m)(`/api/dokumente/${b.anhang}`)).status).toBe(200);
    expect(await suche(m, "Kuendigungsschreiben")).toEqual([]);
    expect(await suche(m, "Bauplan")).toEqual([b.anhang]);
    // Der Inhaber findet beides wie bisher
    expect(await suche(inhaber, "Kuendigungsschreiben")).toEqual([b.mail, b.anhang].sort());

    // Prüfer: dieselbe Regel mit dem Zeitraum
    const einordnen = (id: string, entstanden: string) =>
      als(inhaber)(`/api/dokumente/${id}/einordnung`, json({ art: "beleg", entstanden }));
    const c = await mailMit("Jahresabschluss", "abschluss-mail", "Bilanz");
    await einordnen(c.mail, "2024-03-01");
    await einordnen(c.anhang, "2025-03-01");
    const p2025 = await zugangAnlegen(t, inhaber, "pruefer-2025@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2025-01-01", bis: "2025-12-31" },
    });
    const p2024 = await zugangAnlegen(t, inhaber, "pruefer-2024@example.org", {
      rolle: "pruefer",
      zeitraum: { von: "2024-01-01", bis: "2024-12-31" },
    });
    expect(await suche(p2025, "Jahresabschluss")).toEqual([]);
    expect(await suche(p2025, "Bilanz")).toEqual([c.anhang]);
    expect((await als(p2024)(`/api/dokumente/${c.mail}/datei`)).status).toBe(404);
    expect(await suche(p2024, "Jahresabschluss")).toEqual([]);
  });

  it("zeigt im Verlauf keine Ableitung zu einem Dokument außerhalb", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const form = new FormData();
    form.append("datei", new File([new Uint8Array(await pdf.save())], "quelle.pdf"));
    const quelle = (
      (await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json()) as {
        id: string;
      }
    ).id;
    await ordnen(quelle, { tagsHinzu: [projekt] });
    const gedreht = await als(inhaber)(
      `/api/dokumente/${quelle}/seiten`,
      json({ operation: "drehen", drehungen: [{ seite: 1, grad: 90 }] }),
    );
    expect(gedreht.status).toBe(201);
    const neu = ((await gedreht.json()) as { dokumente: { id: string }[] }).dokumente[0]!.id;
    await ordnen(neu, { tagsHinzu: [projekt, personal] });
    const m = await zugangAnlegen(t, inhaber, "verlauf@example.org", {
      rolle: "mitarbeiter",
      recht: "lesen",
      sichtbereich: { tags: [projekt], ohneTags: [personal] },
    });
    const ableitungen = async (cookie: string) =>
      (
        (await (await als(cookie)(`/api/dokumente/${quelle}/verlauf`)).json()) as {
          ereignisse: { tabelle: string }[];
        }
      ).ereignisse.filter((e) => e.tabelle === "ableitungen");
    expect(await ableitungen(inhaber)).toHaveLength(1);
    expect(await ableitungen(m)).toEqual([]);
  });

  it("führt Mitarbeiter mit Recht und Sichtbereich in der Verfahrensdokumentation", async () => {
    const doku = await (await als(inhaber)("/api/verfahrensdoku")).json();
    const zugriff = doku.abschnitte.find((a: { titel: string }) => a.titel.startsWith("6.")) as { liste: string[] };
    expect(zugriff.liste).toContainEqual(
      expect.stringMatching(
        /^zahlen@example\.org: Mitarbeiter, liest, sieht Dokumente mit Tag „Projekt X“, außer mit Tag „Personal“, seit /,
      ),
    );
    expect(zugriff.liste).toContainEqual(expect.stringMatching(/^wechsel@example\.org: .*entzogen am /));
  });
});
