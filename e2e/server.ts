import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { PDFDocument, StandardFonts } from "pdf-lib";
import postgres from "postgres";
import { SMTPServer } from "smtp-server";
import { zuordnungVorschlaegeErzeugen } from "../server/abgleich/vorschlaege.ts";
import { ansichtenErzeugen } from "../server/ansicht/ansicht.ts";
import { createApp } from "../server/app.ts";
import { archivfassungenErzeugen } from "../server/archivfassung/archivfassung.ts";
import { createAuth } from "../server/auth.ts";
import { smtpVersender } from "../server/benachrichtigungen/versand.ts";
import { verbinden } from "../server/db/client.ts";
import { migrierenMitRechten } from "../server/db/migrieren.ts";
import { erechnungenPruefen } from "../server/erechnung/pruefung.ts";
import { inhalteErzeugen } from "../server/inhalt/inhalt.ts";
import { kiVorschlaegeErzeugen } from "../server/ki/vorschlaege.ts";
import { imapOeffnen } from "../server/mail/imapflow.ts";
import { naechsterImport } from "../server/paperless/ausfuehren.ts";
import { testPaperless } from "../server/paperless/test-paperless.ts";
import { vorschaubilderErzeugen } from "../server/vorschaubild/vorschaubild.ts";
import { workflowsAusfuehren } from "../server/workflows/ausfuehren.ts";

/*
 * Server für die E2E-Tests: frische Datenbank neben E2E_DATABASE_URL (sie wird gelöscht und neu angelegt, nie auf echte
 * Daten zeigen lassen), eigener Speicher, eigener Port. Der Benutzer aus E2E_DATABASE_URL migriert und legt die
 * App-Rolle <name>_app an (braucht CREATEROLE). Playwright startet ihn vor den Tests.
 */
const basis = process.env.E2E_DATABASE_URL ?? "postgres://belegt:belegt@localhost:5432/belegt_e2e";
const port = Number(process.env.E2E_SERVER_PORT ?? 3185);
const url = new URL(basis);
const name = decodeURIComponent(url.pathname.slice(1));

const adminUrl = new URL(basis);
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
await admin`drop database if exists ${admin(name)} with (force)`;
await admin`create database ${admin(name)}`;
// Getrennte Rollen wie im Betrieb (docs/betrieb.md): Der Server läuft als App-Rolle ohne Eigentum an den Tabellen
const appRolle = `${name}_app`;
await admin.unsafe(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = '${appRolle}') then
    create role "${appRolle}" login nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$`);
await admin.unsafe(`alter role "${appRolle}" password 'e2e-app'`);
await admin.end();
const appUrl = new URL(basis);
appUrl.username = appRolle;
appUrl.password = "e2e-app";

await migrierenMitRechten(basis, appUrl.toString());
const { db } = verbinden(appUrl.toString());
const verzeichnis = mkdtempSync(join(tmpdir(), "belegt-e2e-"));
const speicher = dateispeicher({ verzeichnis: () => verzeichnis });
const schluessel = randomBytes(32);
const importOrdner = mkdtempSync(join(tmpdir(), "belegt-e2e-import-"));
// Ein nachgebauter SMTP-Server für Benachrichtigungen und Testmail (e2e/benachrichtigungen.spec.ts); nimmt alles an
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 3187);
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS", "AUTH"],
  logger: false,
  onData: (stream, _sitzung, fertig) => {
    stream.resume();
    stream.on("end", () => fertig());
  },
});
await new Promise<void>((ok) => smtp.listen(SMTP_PORT, "127.0.0.1", ok));
const absender = "belegt@e2e.example";
const mail = { absender, versender: smtpVersender({ url: `smtp://127.0.0.1:${SMTP_PORT}?tls=nein`, absender }) };
const auth = createAuth({
  db,
  secret: "e2e-".repeat(8),
  baseURL: process.env.E2E_APP_URL ?? "http://localhost:5185",
  einrichtungscode: "e2e-einrichtungscode",
});
Bun.serve({
  port,
  fetch: createApp({
    db,
    speicher,
    auth,
    schluessel,
    importOrdner,
    mail,
    oeffnen: imapOeffnen,
    erechnungPruefung: true,
    // Die Seite, die Belegt im Frame zeigen darf; der Test baut sie im Browser nach (e2e/einbetten.spec.ts)
    embedOrigin: "http://localhost:5199",
    // „Öffnen mit …“: die App fängt der Test im Browser ab (e2e/ansicht.spec.ts)
    oeffnenMit: { name: "Office im Browser", url: "https://office.example/oeffnen?datei={url}&name={name}" },
    // Google mit nachgebautem Token-Endpunkt; die Anmeldeseite des Anbieters fängt der Test im Browser ab
    oauth: { google: { clientId: "e2e-client", clientSecret: "e2e-geheim" } },
    abfragen: async () =>
      Response.json({
        access_token: "e2e-access",
        refresh_token: "e2e-refresh",
        id_token: `kopf.${Buffer.from(JSON.stringify({ email: "anna@gmail.example" })).toString("base64url")}.sig`,
      }),
  }).fetch,
  maxRequestBodySize: 110 * 1024 * 1024,
});
/**
 * Statt des Workers: ein Lauf nach dem anderen, jede Sekunde. Mit setInterval stapelten sich Läufe, die länger dauern
 * (Texterkennung, pdftoppm), und ihre Prozesse, bis der Speicher voll war.
 */
function immerWieder(lauf: () => Promise<unknown>) {
  void (async () => {
    for (;;) {
      // Fehler sichtbar lassen: ein stiller Fehler im Worker sieht im Test aus wie eine Zeitüberschreitung
      await lauf().catch((err) => console.error(`E2E-Worker: ${err instanceof Error ? err.message : String(err)}`));
      await Bun.sleep(1000);
    }
  })();
}
// Liest die Inhalte neuer Dokumente
immerWieder(() => inhalteErzeugen({ db, speicher }));
// Workflows
immerWieder(() => workflowsAusfuehren(db));
// Zuordnungsregeln. Gelernte Vorschläge prüft Vitest gegen Postgres; hier tauchten sie je nach Reihenfolge der Specs
// bei Dokumenten anderer Tests auf
immerWieder(() => zuordnungVorschlaegeErzeugen(db));
// Vorschaubilder
immerWieder(() => vorschaubilderErzeugen({ db, speicher }));
// Durchsuchbare PDFs von Scans (mit Tesseract), einer je Lauf
immerWieder(() => archivfassungenErzeugen({ db, speicher }, { stapel: 1 }));
// Ein nachgebauter Vorschau-Dienst: macht aus jeder Office-Datei ein PDF mit ihrem Namen beim Dienst
const vorschauAbfragen = async (_url: string, init: RequestInit) => {
  const datei = (init.body as FormData).get("files") as File;
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText(`Ansicht von ${datei.name}`, { x: 50, y: 700, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return new Response(new Uint8Array(await pdf.save()));
};
/** Nachgebauter KoSIT-Validator: eine Rechnungsnummer mit „UNGUELTIG“ lehnt er ab (BR-CO-15), alles andere nimmt er an */
const validatorAbfragen = async (_url: string, init: RequestInit) => {
  const ungueltig = String(init.body).includes("UNGUELTIG");
  const meldung = ungueltig
    ? '<rep:message level="error" code="BR-CO-15">[BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).</rep:message>'
    : "";
  return new Response(
    `<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1" xmlns:s="http://www.xoev.de/de/validator/framework/1/scenarios"><rep:scenarioMatched><s:scenario><s:name>EN16931 XRechnung (UBL Invoice)</s:name></s:scenario><rep:validationStepResult id="val-sch.1" valid="${!ungueltig}">${meldung}</rep:validationStepResult></rep:scenarioMatched><rep:assessment>${ungueltig ? "<rep:reject/>" : "<rep:accept/>"}</rep:assessment></rep:report>`,
    { status: ungueltig ? 406 : 200 },
  );
};
immerWieder(() => erechnungenPruefen({ db, speicher }, "http://validator.invalid", { abfragen: validatorAbfragen }));
immerWieder(() => ansichtenErzeugen({ db, speicher }, "http://vorschau.invalid", { abfragen: vorschauAbfragen }));
// Ein nachgebautes Sprachmodell: schlägt für Dateien mit „ki-“ im Namen einen Geschäftsbrief vor, sonst nichts Brauchbares
const kiAbfragen = async (_url: string, init: RequestInit) => {
  const nachricht = JSON.parse(String(init.body)).messages.at(-1).content as string;
  const vorschlag = nachricht.includes("Dateiname: ki-")
    ? {
        art: "geschaeftsbrief",
        entstanden: "2026-09-15",
        titel: "Angebot Werkstatt",
        korrespondent: "Werkstatt Beispiel",
        begruendung: "Ein Angebot ist ein Geschäftsbrief.",
      }
    : "kein JSON";
  return Response.json({ message: { content: typeof vorschlag === "string" ? vorschlag : JSON.stringify(vorschlag) } });
};
immerWieder(() =>
  kiVorschlaegeErzeugen(
    db,
    { url: "http://ki.invalid", modell: "e2e-modell" },
    // Der nachgebaute Vorschau-Dienst oben läuft: alte Office-Formate warten auf ihre Ansicht
    { abfragen: kiAbfragen, vorschau: true },
  ),
);
// Ein nachgebautes Paperless-ngx für den Umzug (e2e/umzug.spec.ts); Inhalte, die der Worker nicht lesen muss
const PAPERLESS_PORT = Number(process.env.E2E_PAPERLESS_PORT ?? 3186);
await testPaperless({
  port: PAPERLESS_PORT,
  token: "e2e-paperless-token",
  tags: [
    { id: 1, name: "Strom" },
    { id: 2, name: "Bank" },
  ],
  correspondents: [{ id: 1, name: "Stadtwerke Beispiel" }],
  document_types: [{ id: 1, name: "Rechnung" }],
  dokumente: [
    {
      id: 1,
      title: "Strom März",
      correspondent: 1,
      document_type: 1,
      tags: [1],
      created: "2026-03-01",
      original_file_name: "paperless-strom.bin",
      original: new TextEncoder().encode("Paperless E2E Strom"),
    },
    {
      id: 2,
      title: "Kontoauszug",
      tags: [2],
      created: "2026-03-31",
      original_file_name: "paperless-konto.bin",
      original: new TextEncoder().encode("Paperless E2E Konto"),
    },
  ],
});
// Statt des Workers: Importe aus Paperless-ngx
immerWieder(() => naechsterImport({ db, speicher }, { schluessel, importOrdner }));
console.log(`E2E-Server auf Port ${port}`);
