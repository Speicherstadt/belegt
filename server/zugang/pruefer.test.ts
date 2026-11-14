import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { prueferDarf, prueferZeitraum, schnitt } from "./pruefer.ts";

describe("Prüferzugang ohne Datenbank", () => {
  it("lässt nur lesende Aufrufe für Archiv, Export und Prüfung zu", () => {
    expect(prueferDarf("GET", "/api/dokumente")).toBe(true);
    expect(prueferDarf("GET", "/api/dokumente/abc/datei")).toBe(true);
    expect(prueferDarf("GET", "/api/export")).toBe(true);
    expect(prueferDarf("GET", "/api/dokumente/abc/vorschlag")).toBe(false);
    expect(prueferDarf("GET", "/api/sperren")).toBe(false);
    expect(prueferDarf("GET", "/api/loeschungen")).toBe(false);
    expect(prueferDarf("POST", "/api/dokumente")).toBe(false);
  });

  it("schneidet Zeiträume und sperrt alles, wenn ein Zugang keinen hat", () => {
    expect(schnitt({ von: "2024-01-01", bis: "2024-12-31" }, { von: "2024-06-01", bis: "2025-03-01" })).toEqual({
      von: "2024-06-01",
      bis: "2024-12-31",
    });
    expect(schnitt({ von: "2023-01-01", bis: "2023-12-31" }, { von: "2024-01-01", bis: "2024-12-31" })).toBeNull();
    const leer = prueferZeitraum(null, null);
    expect(leer.von > leer.bis).toBe(true);
  });
});

describe.skipIf(!testDatenbankUrl)("Prüferzugang gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let pruefer: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function dokument(inhalt: string, entstanden: string) {
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode(inhalt)], `${inhalt}.pdf`));
    const d = await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json();
    await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "beleg", entstanden }));
    return d as { id: string };
  }

  let drin: { id: string };
  let draussen: { id: string };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    drin = await dokument("beleg-2024", "2024-05-01");
    draussen = await dokument("beleg-2022", "2022-05-01");
    const einladung = await als(inhaber)(
      "/api/einladungen",
      json({ rolle: "pruefer", zeitraum: { von: "2023-01-01", bis: "2024-12-31" } }),
    );
    expect(einladung.status).toBe(201);
    const { pfad } = await einladung.json();
    pruefer = (
      await t.registrieren("pruefer@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("verlangt für einen Prüfer einen Zeitraum und lehnt ihn für die Steuerberatung ab", async () => {
    expect((await als(inhaber)("/api/einladungen", json({ rolle: "pruefer" }))).status).toBe(400);
    expect(
      (
        await als(inhaber)(
          "/api/einladungen",
          json({ rolle: "pruefer", zeitraum: { von: "2024-12-31", bis: "2024-01-01" } }),
        )
      ).status,
    ).toBe(400);
    // Auch an der App vorbei hält Postgres die Regel
    await expect(
      t.sql`insert into einladungen (token_hash, rolle, gueltig_bis) values ('x', 'pruefer', now())`,
    ).rejects.toThrow(/einladungen_zeitraum/);
    await expect(t.sql`update "user" set zeitraum_von = '2020-01-01' where email = 'anna@example.org'`).rejects.toThrow(
      /user_zeitraum/,
    );
  });

  it("speichert den Zeitraum am Zugang und nennt ihn in /api/ich und der Liste", async () => {
    expect(await (await als(pruefer)("/api/ich")).json()).toMatchObject({
      role: "pruefer",
      zeitraum: { von: "2023-01-01", bis: "2024-12-31" },
    });
    const { zugaenge } = await (await als(inhaber)("/api/zugaenge")).json();
    expect(zugaenge).toContainEqual(
      expect.objectContaining({ email: "pruefer@example.org", zeitraumVon: "2023-01-01", zeitraumBis: "2024-12-31" }),
    );
  });

  it("zeigt dem Prüfer nur Dokumente seines Zeitraums", async () => {
    const liste = await (await als(pruefer)("/api/dokumente")).json();
    expect(liste.map((d: { id: string }) => d.id)).toEqual([drin.id]);
    expect((await als(pruefer)(`/api/dokumente/${drin.id}/datei`)).status).toBe(200);
    for (const pfad of ["", "/datei", "/ansicht", "/verlauf", "/mail"])
      expect((await als(pruefer)(`/api/dokumente/${draussen.id}${pfad}`)).status).toBe(404);
    // Der Inhaber sieht weiter alles
    expect(await (await als(inhaber)("/api/dokumente")).json()).toHaveLength(2);
  });

  it("sperrt Seiten außerhalb von Archiv und Prüfung", async () => {
    for (const pfad of ["/api/sperren", "/api/loeschungen", "/api/regeln", "/api/quellen", "/api/fristen/uebersicht"])
      expect((await als(pruefer)(pfad)).status).toBe(403);
    expect((await als(pruefer)(`/api/dokumente/${drin.id}/vorschlag`)).status).toBe(403);
    expect((await als(pruefer)("/api/pruefung")).status).toBe(200);
  });

  it("beschränkt den Z3-Export auf die Freigabe", async () => {
    const res = await als(pruefer)("/api/export?von=2020-01-01&bis=2030-12-31");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("belegt-z3-2023-01-01-2024-12-31.zip");
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const dokumente = strFromU8(zip["dokumente.csv"]!);
    expect(dokumente).toContain(drin.id);
    expect(dokumente).not.toContain(draussen.id);
    expect((await als(pruefer)("/api/export?von=2020-01-01&bis=2021-12-31")).status).toBe(403);
  });
  it("zeigt zu einem Anhang im Zeitraum nicht die Mail außerhalb", async () => {
    const eml = [
      "From: Lieferant <rechnung@example.org>",
      "To: anna@example.org",
      "Subject: Vertraulich 2022",
      "Message-ID: <alt-2022@example.org>",
      "Date: Mon, 02 May 2022 10:00:00 +0200",
      'Content-Type: multipart/mixed; boundary="g"',
      "",
      "--g",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Geheimer Text aus 2022.",
      "--g",
      'Content-Type: application/pdf; name="Anhang.pdf"',
      'Content-Disposition: attachment; filename="Anhang.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.7\n% Anhang\n").toString("base64"),
      "--g--",
      "",
    ].join("\r\n");
    const form = new FormData();
    form.append("datei", new File([eml], "alt.eml"));
    const { neu } = await (await als(inhaber)("/api/mails", { method: "POST", body: form })).json();
    const mail = await (await als(inhaber)(`/api/dokumente/${neu[0]}/mail`)).json();
    const anhang = mail.anhaenge[0].dokumentId as string;
    await als(inhaber)(`/api/dokumente/${neu[0]}/einordnung`, json({ art: "beleg", entstanden: "2022-05-02" }));
    await als(inhaber)(`/api/dokumente/${anhang}/einordnung`, json({ art: "beleg", entstanden: "2024-05-02" }));

    expect((await als(pruefer)(`/api/dokumente/${anhang}`)).status).toBe(200);
    const res = await als(pruefer)(`/api/dokumente/${anhang}/mail`);
    const text = await res.text();
    expect(text).not.toContain("Vertraulich 2022");
    expect(text).not.toContain("Geheimer Text");
    expect(text).not.toContain("alt-2022@example.org");
  });

  it("nimmt in das Protokoll des Prüfer-Exports nur Einträge zu Dokumenten seines Zeitraums", async () => {
    const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
    const jahr = heute.slice(0, 4);
    const jetzt = await dokument("beleg-jetzt", `${jahr}-03-01`);
    expect(
      (await als(inhaber)("/api/sperren", json({ grund: "Sperre-Geheim", von: "2020-01-01", bis: "2020-12-31" })))
        .status,
    ).toBe(201);
    const { pfad } = await (
      await als(inhaber)(
        "/api/einladungen",
        json({ rolle: "pruefer", zeitraum: { von: `${jahr}-01-01`, bis: `${jahr}-12-31` } }),
      )
    ).json();
    const zweiter = (
      await t.registrieren("pruefer2@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;

    const res = await als(zweiter)(`/api/export?von=${jahr}-01-01&bis=${jahr}-12-31`);
    expect(res.status).toBe(200);
    const protokoll = strFromU8(unzipSync(new Uint8Array(await res.arrayBuffer()))["protokoll.csv"]!);
    expect(protokoll).toContain(jetzt.id);
    // Hochgeladen im Zeitraum, entstanden 2022: gehört nicht zur Freigabe, auch nicht sein Eintrag im Audit-Log
    expect(protokoll).not.toContain(draussen.id);
    expect(protokoll).not.toContain("beleg-2022");
    // Sperren, Einladungen und Zugänge sieht der Prüfer nicht
    expect(protokoll).not.toContain("Sperre-Geheim");
    expect(protokoll).not.toContain('anna@example.org"');
    expect(protokoll).not.toContain("pruefer@example.org");
  });
});
