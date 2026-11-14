import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { PDFDocument, StandardFonts } from "pdf-lib";
import postgres from "postgres";
import { ansichtenErzeugen } from "../server/ansicht/ansicht.ts";
import { createApp } from "../server/app.ts";
import { createAuth } from "../server/auth.ts";
import { verbinden } from "../server/db/client.ts";
import { migrieren } from "../server/db/migrieren.ts";
import { inhalteErzeugen } from "../server/inhalt/inhalt.ts";
import { kiVorschlaegeErzeugen } from "../server/ki/vorschlaege.ts";
import { imapOeffnen } from "../server/mail/imapflow.ts";

/*
 * Server für die E2E-Tests: frische Datenbank neben E2E_DATABASE_URL (sie wird gelöscht und neu angelegt, nie auf echte
 * Daten zeigen lassen), eigener Speicher, eigener Port. Playwright startet ihn vor den Tests.
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
await admin.end();

await migrieren(basis);
const { db } = verbinden(basis);
const verzeichnis = mkdtempSync(join(tmpdir(), "belegt-e2e-"));
const speicher = dateispeicher({ verzeichnis: () => verzeichnis });
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
    schluessel: randomBytes(32),
    oeffnen: imapOeffnen,
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
// Statt des Workers: liest die Inhalte neuer Dokumente jede Sekunde
setInterval(() => void inhalteErzeugen({ db, speicher }).catch(() => {}), 1000);
// Ein nachgebauter Vorschau-Dienst: macht aus jeder Office-Datei ein PDF mit ihrem Namen beim Dienst
const vorschauAbfragen = async (_url: string, init: RequestInit) => {
  const datei = (init.body as FormData).get("files") as File;
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText(`Ansicht von ${datei.name}`, { x: 50, y: 700, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return new Response(new Uint8Array(await pdf.save()));
};
setInterval(
  () =>
    void ansichtenErzeugen({ db, speicher }, "http://vorschau.invalid", { abfragen: vorschauAbfragen }).catch(() => {}),
  1000,
);
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
setInterval(
  () =>
    void kiVorschlaegeErzeugen(db, { url: "http://ki.invalid", modell: "e2e-modell" }, { abfragen: kiAbfragen }).catch(
      () => {},
    ),
  1000,
);
console.log(`E2E-Server auf Port ${port}`);
