import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inhalteErzeugen } from "../inhalt/inhalt.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { type Abfragen, beimDienstPruefen, berichtLesen, erechnungenPruefen } from "./pruefung.ts";

/*
 * Testdateien in beispiele/: xrechnung-gueltig.xml und xrechnung-ungueltig.xml hat Belegt selbst geschrieben (erfundene
 * Firmen, die ungültige mit falschem Gesamtbetrag, BR-CO-15); bericht-*.xml sind Prüfberichte des KoSIT-Validators 1.6.3
 * mit der Konfiguration XRechnung 3.0.2 vom 2026-08-31 dazu (und zu <foo/>), gekürzt um die Erklärung als HTML.
 */
const beispiel = (name: string) => readFileSync(new URL(`./beispiele/${name}`, import.meta.url), "utf8");

/** Nachgebauter Validator: annehmbar, wenn die Rechnung nicht die ungültige ist */
const validator =
  (antwort?: (xml: string) => Response): Abfragen =>
  async (_url, init) => {
    const xml = String(init.body);
    if (antwort) return antwort(xml);
    return xml.includes("129.00")
      ? new Response(beispiel("bericht-ungueltig.xml"), { status: 406 })
      : new Response(beispiel("bericht-gueltig.xml"), { status: 200 });
  };

describe("Prüfbericht des KoSIT-Validators", () => {
  it("liest eine gültige Rechnung mit Szenario und ohne Fehler", () => {
    expect(berichtLesen(beispiel("bericht-gueltig.xml"))).toEqual({
      gueltig: true,
      szenario: "EN16931 XRechnung (UBL Invoice)",
      fehler: 0,
      warnungen: 0,
      meldungen: [],
    });
  });

  it("liest Fehler mit Code und Text, Informationen fallen weg", () => {
    const p = berichtLesen(beispiel("bericht-ungueltig.xml"))!;
    expect(p).toMatchObject({ gueltig: false, szenario: "EN16931 XRechnung (UBL Invoice)", fehler: 2, warnungen: 0 });
    expect(p.meldungen.map((m) => m.code)).toEqual(["BR-CO-15", "BR-CO-16"]);
    expect(p.meldungen[0]!.text).toMatch(/^\[BR-CO-15\]-Invoice total amount with VAT/);
  });

  it("meldet ein XML ohne passendes Szenario als ungültig", () => {
    expect(berichtLesen(beispiel("bericht-ohne-szenario.xml"))).toMatchObject({
      gueltig: false,
      szenario: null,
      fehler: 1,
      meldungen: [{ stufe: "fehler", text: expect.stringContaining("Kein passendes Prüfszenario") }],
    });
  });

  it("nennt keinen Bericht, wenn die Antwort keiner ist", () => {
    expect(berichtLesen("<html>Proxy-Fehler</html>")).toBeNull();
    expect(berichtLesen("kein XML <")).toBeNull();
  });

  it("hält höchstens 20 Meldungen mit je 300 Zeichen fest", () => {
    const viele = Array.from(
      { length: 30 },
      (_, i) => `<rep:message level="error" code="R${i}">${"x".repeat(400)}</rep:message>`,
    ).join("");
    const p = berichtLesen(
      `<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1"><rep:scenarioMatched><rep:validationStepResult>${viele}</rep:validationStepResult></rep:scenarioMatched><rep:assessment><rep:reject/></rep:assessment></rep:report>`,
    )!;
    expect(p.fehler).toBe(30);
    expect(p.meldungen).toHaveLength(20);
    expect(p.meldungen[0]!.text).toHaveLength(300);
  });

  it("hält Ausfälle des Dienstes für vorübergehend, ein unlesbares XML für einen Befund", async () => {
    const xml = beispiel("xrechnung-gueltig.xml");
    for (const antwort of [
      () => new Response("ausgelastet", { status: 503 }),
      () => new Response("zu viele", { status: 429 }),
      () => new Response("<html/>", { status: 200 }),
      () => {
        throw new Error("ECONNREFUSED");
      },
    ])
      await expect(beimDienstPruefen(xml, "http://v", { abfragen: validator(antwort) })).rejects.toMatchObject({
        nichtErreichbar: true,
      });
    expect(
      await beimDienstPruefen(xml, "http://v", { abfragen: validator(() => new Response("", { status: 422 })) }),
    ).toMatchObject({ gueltig: false, fehler: 1 });
  });

  it("schickt das XML als application/xml und folgt keiner Weiterleitung", async () => {
    let gesendet: RequestInit | undefined;
    await beimDienstPruefen("<x/>", "http://validator:8080", {
      abfragen: async (_u, init) => {
        gesendet = init;
        return new Response(beispiel("bericht-gueltig.xml"));
      },
    });
    expect(gesendet).toMatchObject({ method: "POST", body: "<x/>", redirect: "manual" });
    expect(new Headers(gesendet!.headers).get("content-type")).toBe("application/xml");
  });
});

describe.skipIf(!testDatenbankUrl)("E-Rechnungen prüfen gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const als = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);
  const hoch = async (inhalt: Uint8Array | string, name: string) => {
    const f = new FormData();
    const bytes = typeof inhalt === "string" ? new TextEncoder().encode(inhalt) : inhalt;
    f.append("datei", new File([new Uint8Array(bytes)], name));
    return (await (await als("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
  };
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("prüft XRechnung und ZUGFeRD erst nach dem Lesen, hält das Ergebnis fest und filtert die ungültigen", async () => {
    const gut = await hoch(beispiel("xrechnung-gueltig.xml"), "gut.xml");
    const schlecht = await hoch(beispiel("xrechnung-ungueltig.xml"), "schlecht.xml");
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await pdf.attach(
      new TextEncoder().encode(beispiel("xrechnung-ungueltig.xml").replace("2026-0815", "Z-1")),
      "xrechnung.xml",
      {
        mimeType: "text/xml",
      },
    );
    const zugferd = await hoch(new Uint8Array(await pdf.save()), "zugferd.pdf");
    const kein = await hoch("nur Text, keine Rechnung", "notiz.txt");

    // Noch nicht gelesen: nichts zu prüfen
    expect(await erechnungenPruefen(t, "http://v", { abfragen: validator() })).toEqual({ geprueft: 0, ungueltig: 0 });
    await inhalteErzeugen(t);
    expect(await erechnungenPruefen(t, "http://v", { abfragen: validator() })).toEqual({ geprueft: 3, ungueltig: 2 });
    expect(await erechnungenPruefen(t, "http://v", { abfragen: validator() })).toEqual({ geprueft: 0, ungueltig: 0 });

    const pruefung = async (id: string) => (await (await als(`/api/dokumente/${id}/inhalt`)).json()).pruefung;
    expect(await pruefung(gut.id)).toMatchObject({
      gueltig: true,
      fehler: 0,
      szenario: "EN16931 XRechnung (UBL Invoice)",
    });
    expect(await pruefung(schlecht.id)).toMatchObject({
      gueltig: false,
      fehler: 2,
      meldungen: [{ stufe: "fehler", code: "BR-CO-15" }, { code: "BR-CO-16" }],
    });
    expect(await pruefung(zugferd.id)).toMatchObject({ gueltig: false });
    expect(await pruefung(kein.id)).toBeNull();

    const liste = await (await als("/api/dokumente?gruppe=erechnung_ungueltig")).json();
    expect(liste.map((d: { id: string }) => d.id).sort()).toEqual([schlecht.id, zugferd.id].sort());
  });

  it("versucht es bei einem Ausfall des Dienstes später wieder, ohne etwas festzuhalten", async () => {
    const d = await hoch(beispiel("xrechnung-gueltig.xml").replace("2026-0815", "später"), "spaeter.xml");
    await inhalteErzeugen(t);
    const aus = validator(() => new Response("", { status: 502 }));
    expect(await erechnungenPruefen(t, "http://v", { abfragen: aus })).toMatchObject({
      geprueft: 0,
      meldung: "Validator antwortet 502",
    });
    expect(await t.sql`select 1 from erechnung_pruefungen where dokument_id = ${d.id}`).toHaveLength(0);
    expect(await erechnungenPruefen(t, "http://v", { abfragen: validator() })).toMatchObject({ geprueft: 1 });
  });

  it("entfernt die Prüfung mit der bestätigten Löschung, und danach kommt keine mehr hinein", async () => {
    const d = await hoch(beispiel("xrechnung-gueltig.xml").replace("2026-0815", "weg"), "weg.xml");
    await inhalteErzeugen(t);
    await erechnungenPruefen(t, "http://v", { abfragen: validator() });
    await als(`/api/dokumente/${d.id}/einordnung`, json({ art: "frei", entstanden: "2026-11-01" }));
    expect((await als(`/api/dokumente/${d.id}/loeschung`, { method: "POST" })).status).toBe(201);
    expect(await t.sql`select 1 from erechnung_pruefungen where dokument_id = ${d.id}`).toHaveLength(0);
    await t.sql`insert into erechnung_pruefungen (dokument_id, gueltig, fehler, warnungen) values (${d.id}, true, 0, 0)`;
    expect(await t.sql`select 1 from erechnung_pruefungen where dokument_id = ${d.id}`).toHaveLength(0);
  });
});

/** Mit dem echten Validator (CI: Dienst aus deploy/validator), sonst übersprungen */
describe.skipIf(!process.env.VALIDATOR_TEST_URL)("Prüfung mit dem echten KoSIT-Validator", () => {
  const url = process.env.VALIDATOR_TEST_URL ?? "";
  it("nimmt die gültige XRechnung an und lehnt die ungültige mit BR-CO-15 ab", async () => {
    expect(await beimDienstPruefen(beispiel("xrechnung-gueltig.xml"), url)).toMatchObject({
      gueltig: true,
      fehler: 0,
      szenario: "EN16931 XRechnung (UBL Invoice)",
    });
    const p = await beimDienstPruefen(beispiel("xrechnung-ungueltig.xml"), url);
    expect(p.gueltig).toBe(false);
    expect(p.meldungen.map((m) => m.code)).toContain("BR-CO-15");
  });
});
