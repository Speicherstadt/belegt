import { formatPruefwert } from "@firsttris/gobd-kern/pruefwert";
import { alsMarkdown, fehlendeAngaben, KERN_TEXTE, LEERE_ANGABEN } from "@firsttris/gobd-kern/verfahrensdoku";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kettePruefen } from "../pruefung/kette.ts";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { prueferDarf } from "../zugang/pruefer.ts";
import { verfahrensdoku } from "./verfahrensdoku.ts";

describe.skipIf(!testDatenbankUrl)("Einstellungen und Verfahrensdokumentation gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;
  const als =
    (cookie: string) =>
    (pfad: string, init: RequestInit = {}) =>
      t.anfrage(pfad, init, cookie);
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const angaben = {
    firma: "Muster & Söhne GmbH",
    anschrift: "Musterweg 1, 12345 Musterstadt",
    verantwortlich: "Anna Muster",
    aufsicht: false,
    datensicherung: "Täglich verschlüsselt auf ein zweites Gerät, monatlich Wiederherstellung geprüft.",
    papierbelege: "Es wird nicht gescannt.",
    ergaenzungen: "",
    rechtsform: "GmbH",
    aufbewahrungsort: "Server und Sicherungen im Büro in Musterstadt, Deutschland",
    serverbetrieb: "Anna Muster betreibt den Server selbst und spielt Updates monatlich ein.",
    schluesselablage: "Im Tresor des Büros; im Notfall hat der Steuerberater Zugang.",
  };
  type Doku = {
    titel: string;
    stand: { datum: string; programm: string; version: string };
    luecken: number;
    vollstaendig: boolean;
    abschnitte: { titel: string; absaetze: string[]; liste?: string[]; luecken?: string[] }[];
  };

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    const { pfad } = await (await als(inhaber)("/api/einladungen", json({ rolle: "steuerberatung" }))).json();
    kanzlei = (
      await t.registrieren("kanzlei@example.org", "ein-langes-passwort", {
        "x-belegt-einladung": pfad.split("/").pop(),
      })
    ).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("nennt ohne Angaben die Lücken, statt sie zu füllen", async () => {
    const doku: Doku = await (await als(inhaber)("/api/verfahrensdoku")).json();
    expect(doku.vollstaendig).toBe(false);
    const luecken = doku.abschnitte.flatMap((a) => a.luecken ?? []);
    expect(luecken).toEqual(
      expect.arrayContaining([
        "Name des Betriebs",
        "verantwortliche Person (und wer vertritt)",
        expect.stringMatching(/^Beschreibung der Datensicherung/),
      ]),
    );
    // Jede Angabe zum Betrieb aus dem Schema des Kerns fehlt genau einmal, die Ergänzungen nie
    expect([...luecken].sort()).toEqual(fehlendeAngaben(LEERE_ANGABEN).sort());
    expect(doku.luecken).toBe(luecken.length);
    expect(doku.titel).toBe("Verfahrensdokumentation");
    expect(JSON.stringify(doku)).toContain("Buchungsbelege werden acht Jahre aufbewahrt");
    expect(JSON.stringify(doku)).toContain("im Dateisystem des Servers");
    expect(JSON.stringify(doku)).toContain("ein durchsuchbares PDF (PDF/A-2b");
  });

  it("speichert Angaben nur durch den Inhaber, mit Eintrag im Audit-Log", async () => {
    expect((await als(kanzlei)("/api/einstellungen", json(angaben))).status).toBe(403);
    expect((await als(inhaber)("/api/einstellungen", json({ ...angaben, firma: "x".repeat(301) }))).status).toBe(400);
    const res = await als(inhaber)("/api/einstellungen", json(angaben));
    expect(res.status).toBe(200);
    expect(await (await als(kanzlei)("/api/einstellungen")).json()).toMatchObject(angaben);
    const [eintrag] = await t.sql`
      select actor, action from audit_log where table_name = 'einstellungen' order by seq desc limit 1`;
    expect(eintrag).toEqual({ actor: "nutzer:anna@example.org", action: "UPDATE" });
  });

  it("beschreibt Betrieb, Regeln und Zugänge und ist mit allen Angaben vollständig", async () => {
    await als(inhaber)("/api/regeln", json({ name: "Telefon", wenn: { domain: "telefon.example" }, dann: "beleg" }));
    const doku: Doku = await (await als(kanzlei)("/api/verfahrensdoku")).json();
    expect(doku.vollstaendig).toBe(true);
    expect(doku.luecken).toBe(0);
    const text = JSON.stringify(doku);
    expect(text).toContain("Muster & Söhne GmbH archiviert");
    expect(text).toContain("Verantwortlich: Anna Muster");
    expect(text).toContain("Täglich verschlüsselt");
    expect(text).toContain("Regel „Telefon“ schlägt vor: Buchungsbelege");
    expect(text).toMatch(/kanzlei@example\.org: Steuerberatung, seit [\d-]+, ohne zweiten Faktor/);
    expect(text).toContain("Ein zweiter Faktor ist für keine Rolle Pflicht.");
    expect(doku.titel).toBe("Verfahrensdokumentation Muster & Söhne GmbH");
    expect(doku.stand).toEqual({
      datum: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      programm: "Belegt",
      version: expect.any(String),
    });
    // Jede Angabe steht mit ihrer Beschriftung im Abschnitt, in den sie gehört
    const abschnitt = (nr: string) => doku.abschnitte.find((a) => a.titel.startsWith(nr))!.absaetze;
    expect(abschnitt("1.")).toEqual(
      expect.arrayContaining([
        "Rechtsform: GmbH",
        "Anschrift: Musterweg 1, 12345 Musterstadt",
        "Verantwortlich: Anna Muster",
        `Ort der Aufbewahrung: ${angaben.aufbewahrungsort}`,
      ]),
    );
    expect(abschnitt("7.")).toEqual(
      expect.arrayContaining([
        `Betrieb des Servers: ${angaben.serverbetrieb}`,
        `Datensicherung: ${angaben.datensicherung}`,
        `Ablage von Schlüsseln und Passwörtern: ${angaben.schluesselablage}`,
      ]),
    );
    expect(doku.abschnitte.find((a) => a.titel === "8. Papierbelege und Scannen")!.absaetze).toEqual([
      "Papierbelege und Scannen: Es wird nicht gescannt.",
    ]);
  });

  it("nimmt die Texte zum Kern und ergänzt sie um das, was nur Belegt betrifft", async () => {
    const doku: Doku = await (await als(kanzlei)("/api/verfahrensdoku")).json();
    const kern = doku.abschnitte.find((a) => a.titel === "4. Unveränderbarkeit und Nachvollziehbarkeit")!;
    const nach = (kerntext: string) => kern.absaetze[kern.absaetze.findIndex((a) => a.startsWith(kerntext)) + 1];
    for (const text of [KERN_TEXTE.unveraenderbarkeit, KERN_TEXTE.auditLog, KERN_TEXTE.hashKette, KERN_TEXTE.dateien])
      expect(kern.absaetze).toContain(text);
    expect(kern.absaetze).toContain(`${KERN_TEXTE.siegel} ${KERN_TEXTE.korrektur}`);
    // Den Satz zur Anmeldung liefert der Kern (datenbankRollenText); die Fälle prüft datenbank.test.ts
    expect(nach(KERN_TEXTE.siegel)).toMatch(/^Die Anwendung meldet sich bei der Datenbank als „.+“ an/);
    expect(nach(KERN_TEXTE.dateien)).toBe("Die Dateien liegen im Dateisystem des Servers.");
    expect(nach(KERN_TEXTE.pruefung)).toBe(
      "Aufrufen lässt sie sich unter „Prüfung“; dort vergleicht sie auf Wunsch auch jede Datei mit ihrem Hash.",
    );
    expect(kern.absaetze).toContain(
      "Bei Erstellung dieses Dokuments meldete die Prüfung von Kette, Kopf und Siegeln keine Befunde.",
    );
    const [kopf] = await t.sql`select seq, encode(hash, 'hex') as hash from audit_chain where id = 1`;
    expect(kern.absaetze.at(-1)).toBe(
      `${KERN_TEXTE.pruefwert} Bei Erstellung dieses Dokuments: ${formatPruefwert({ seq: Number(kopf!.seq), hash: kopf!.hash })}.`,
    );
    expect(kern.liste).toEqual(
      expect.arrayContaining([
        "Versiegelt: Dokumente, ab dem Einfügen",
        "Versiegelt: Archivnummern, ab dem Einfügen",
        "Versiegelt: Löschnachweise, sobald die Löschung bestätigt ist",
      ]),
    );
  });

  it("gibt dieselbe Fassung als Markdown aus, für alle, die sie lesen dürfen", async () => {
    const doku: Doku = await (await als(kanzlei)("/api/verfahrensdoku")).json();
    // Die Oberfläche erzeugt die Datei mit alsMarkdown aus genau dieser Antwort
    const md = alsMarkdown(doku);
    expect(md.startsWith("# Verfahrensdokumentation Muster & Söhne GmbH\n\n")).toBe(true);
    expect(md).toContain(`Stand: ${doku.stand.datum} · Belegt ${doku.stand.version} · vollständig`);
    for (const a of doku.abschnitte) expect(md).toContain(`\n## ${a.titel.replace(/^(\d+)\./, "$1\\.")}\n`);
    expect(md).toContain("\n- Regel „Telefon“ schlägt vor: Buchungsbelege");
    expect(md).toContain("Verantwortlich: Anna Muster");
    expect(md).not.toContain("Fehlt:");
    // Wer die Verfahrensdokumentation nicht lesen darf, bekommt auch kein Markdown
    expect(prueferDarf("GET", "/api/verfahrensdoku")).toBe(false);
  });

  it("nennt im Markdown jede offene Lücke", async () => {
    await als(inhaber)("/api/einstellungen", json({ ...angaben, schluesselablage: "", rechtsform: "" }));
    const doku: Doku = await (await als(inhaber)("/api/verfahrensdoku")).json();
    expect(doku.luecken).toBe(2);
    const md = alsMarkdown(doku);
    expect(md).toContain("unvollständig, 2 Angaben fehlen");
    expect(md).toContain("> **Fehlt:** Rechtsform");
    expect(md).toContain("> **Fehlt:** wo Schlüssel, Passwörter und Zertifikate verwahrt werden (nur der Ort)");
    await als(inhaber)("/api/einstellungen", json(angaben));
  });

  it("übernimmt Werte aus der ersten Fassung der Einstellungen (Spalte scannen) als Papierbelege", async () => {
    await t.sql`update einstellungen set scannen = 'Scans prüft die Buchhaltung am selben Tag.' where id = 1`;
    expect(await (await als(inhaber)("/api/einstellungen")).json()).toMatchObject({
      papierbelege: "Scans prüft die Buchhaltung am selben Tag.",
    });
    const doku: Doku = await (await als(inhaber)("/api/verfahrensdoku")).json();
    expect(doku.abschnitte.find((a) => a.titel.startsWith("8."))!.absaetze).toEqual([
      "Papierbelege und Scannen: Scans prüft die Buchhaltung am selben Tag.",
    ]);
    await als(inhaber)("/api/einstellungen", json(angaben));
  });

  it("nennt im Zugriff die API-Tokens, die schreiben oder lesen, ohne ihr Geheimnis", async () => {
    const anlegen = async (name: string, recht: string) =>
      (await (await als(inhaber)("/api/tokens", json({ name, recht }))).json()) as { id: string; klartext: string };
    const kasse = await anlegen("Kasse", "schreiben");
    const bi = await anlegen("Auswertung", "lesen");
    const alt = await anlegen("Altes Skript", "schreiben");
    await als(inhaber)(`/api/tokens/${alt.id}/widerrufen`, { method: "POST" });
    const doku = await (await als(kanzlei)("/api/verfahrensdoku")).json();
    const zugriff = doku.abschnitte.find((a: { titel: string }) => a.titel === "6. Zugriff");
    const text = JSON.stringify(zugriff);
    expect(text).toContain("API-Token „Kasse“: liest, nimmt auf und ordnet ein");
    expect(text).toContain("API-Token „Auswertung“: liest");
    expect(text).not.toContain("Altes Skript");
    expect(text).not.toMatch(/Nur der Inhaber schreibt;/);
    for (const t of [kasse, bi]) expect(JSON.stringify(doku)).not.toContain(t.klartext);
  });

  it("rechnet für ein Institut unter Aufsicht zehn Jahre für Buchungsbelege", async () => {
    await als(inhaber)("/api/einstellungen", json({ ...angaben, aufsicht: true }));
    const form = new FormData();
    form.append("datei", new File([new TextEncoder().encode("%PDF-1.7\n% Bankbeleg\n")], "bank.pdf"));
    const d = await (await als(inhaber)("/api/dokumente", { method: "POST", body: form })).json();
    const e = await (
      await als(inhaber)(`/api/dokumente/${d.id}/einordnung`, json({ art: "beleg", entstanden: "2026-03-01" }))
    ).json();
    expect(e.fristBis).toBe("2036-12-31");
    expect(JSON.stringify(await (await als(inhaber)("/api/verfahrensdoku")).json())).toContain(
      "Buchungsbelege werden deshalb zehn Jahre aufbewahrt",
    );
    await als(inhaber)("/api/einstellungen", json(angaben));
  });

  it("nennt den Betrieb als Datenlieferant im Z3-Export", async () => {
    const res = await als(inhaber)("/api/export?von=2026-01-01&bis=2026-12-31");
    const index = new TextDecoder().decode(unzipSync(new Uint8Array(await res.arrayBuffer()))["index.xml"]);
    expect(index).toContain("<Name>Muster &amp; Söhne GmbH</Name>");
    expect(index).toContain("<Location>Musterweg 1, 12345 Musterstadt</Location>");
  });

  it("nennt ein eingerichtetes Sprachmodell mit Server und was es bekommt", async () => {
    const doku = await verfahrensdoku(t.db, {
      abrufMinuten: 5,
      version: "test",
      kiModell: { modell: "qwen2.5:7b", host: "ollama:11434" },
    });
    expect(JSON.stringify(doku)).toContain("Ein Sprachmodell (qwen2.5:7b auf ollama:11434) schlägt");
    expect(JSON.stringify(doku)).toContain("Regeln und das Sprachmodell machen nur Vorschläge");
  });

  it("nennt den Eingangsordner nur, wenn er eingerichtet ist", async () => {
    const ohne = JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }));
    expect(ohne).not.toContain("Eingangsordner");
    const mit = JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test", eingangsordner: true }));
    expect(mit).toContain("Ein Eingangsordner (etwa das Ziel eines Scanners) wird alle 5 Sekunden überwacht");
    expect(mit).toContain("Unterordner „fehler“");
  });

  it("nennt Duplikate, Prüfung der E-Rechnungen, Weitergabe und Benachrichtigungen, wo die Abläufe stehen", async () => {
    const ohne = JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }));
    expect(ohne).toContain("Dieselbe Datei (gleicher SHA-256) nimmt Belegt nur einmal auf");
    expect(ohne).toContain("verweist die Mail auf dieses Dokument");
    expect(ohne).not.toContain("KoSIT");
    expect(ohne).toContain("Benachrichtigungen per Mail sind nicht eingerichtet");
    const mit = JSON.stringify(
      await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test", erechnungPruefung: true, mail: true }),
    );
    expect(mit).toContain("mit dem Validator der Koordinierungsstelle für IT-Standards (KoSIT)");
    expect(mit).toMatch(/Belegt meldet per Mail an 1 Empfänger, wenn etwas Aufmerksamkeit braucht: Sicherung/);
    expect(mit).toContain("fehlgeschlagene Workflows und aufgegebene Weitergaben");
    expect(mit).not.toContain("zu viele Dokumente im Eingang");
  });

  it("beschreibt einen Workflow, der das Original sendet, mit Ziel und Dateifeld, ohne den Wert der Kopfzeile", async () => {
    const res = await als(inhaber)(
      "/api/workflows",
      json({
        name: "An Buchhaltung",
        ausloeser: "eingeordnet",
        aktionen: [
          {
            art: "senden",
            url: "https://buchhaltung.example/api/v1/belege?x=1",
            dateifeld: "datei",
            kopfzeile: { name: "Authorization", wert: "Bearer geheim-123" },
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const doku = JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }));
    expect(doku).toContain(
      "dann Original an https://buchhaltung.example/api/v1/belege senden (Feld „datei“, Anmeldung über die Kopfzeile Authorization)",
    );
    expect(doku).toContain("das Original an eine Adresse senden");
    expect(doku).not.toContain("geheim-123");
    await als(inhaber)(`/api/workflows/${(await res.json()).id}`, { method: "DELETE" });
  });

  it("beschreibt das Teilen an Trennblättern mit dem eingestellten Code", async () => {
    const ohne = JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }));
    expect(ohne).toContain("an Trennblättern (QR-Code oder Code 128 mit dem Inhalt „BELEGT-TRENNER“) beim Hochladen");
    const mit = JSON.stringify(
      await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test", eingangsordner: true, trennblattCode: "X-1" }),
    );
    expect(mit).toContain("„X-1“) aus dem Eingangsordner immer und beim Hochladen auf Wunsch");
    expect(mit).toContain("Jedes Teil wird als eigenes Original aufgenommen");
  });

  it("erwähnt Teilen per Link erst, wenn es genutzt wurde, mit Zahl der gültigen Links", async () => {
    expect(JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }))).not.toContain("per Link");
    const f = new FormData();
    f.append("datei", new File(["x"], "geteilt.pdf"));
    const d = await (await als(inhaber)("/api/dokumente", { method: "POST", body: f })).json();
    expect((await als(inhaber)(`/api/dokumente/${d.id}/links`, json({ tage: 7 }))).status).toBe(201);
    const mit = JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }));
    expect(mit).toContain("per Link an Personen ohne Zugang geben, für 1, 7 oder höchstens 30 Tage");
    expect(mit).toContain("ohne IP-Adresse");
    expect(mit).toContain("Bisher wurde 1 Link angelegt, 1 gilt derzeit.");
  });
});

describe.skipIf(!testDatenbankUrl)("Verfahrensdokumentation eines frischen Archivs gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  const doku = async () => JSON.stringify(await verfahrensdoku(t.db, { abrufMinuten: 5, version: "test" }));

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("zählt ein Dokument und eine Mail in der Einzahl", async () => {
    const mail = [
      "From: a@example.org",
      "To: b@example.org",
      "Subject: Hallo",
      "Message-ID: <1@example.org>",
      "",
      "Text",
      "",
    ];
    const form = new FormData();
    form.append("datei", new File([mail.join("\r\n")], "m.eml"));
    expect((await t.anfrage("/api/mails", { method: "POST", body: form }, inhaber)).status).toBe(201);
    expect(await doku()).toMatch(
      /Stand des Archivs: 1 Dokument, davon 1 Mail und 0 nach Ablauf der Frist gelöscht; \d+ Einträge im Protokoll\./,
    );
  });

  it("nennt die tägliche gespeicherte Prüfung der Kette mit dem letzten Lauf", async () => {
    const vorher = await doku();
    expect(vorher).toContain("Der Worker prüft Kette, Kopf und Siegel einmal am Tag und hält jeden Lauf");
    expect(vorher).toContain("Ein gespeicherter Lauf liegt noch nicht vor.");
    const lauf = await kettePruefen(t.db, "system:worker");
    expect(lauf).not.toBeNull();
    expect(await doku()).toMatch(/Der letzte gespeicherte Lauf vom \d{4}-\d{2}-\d{2} meldete keine Befunde\./);
  });

  it("beschreibt den ZIP-Download mit Sicht, Grenzen und den nicht enthaltenen Dokumenten", async () => {
    const text = await doku();
    expect(text).toContain("als ZIP herunterladen");
    expect(text).toContain("höchstens 200 Dokumente und 2 GB");
    expect(text).toContain("nicht-enthalten.txt");
  });
});
