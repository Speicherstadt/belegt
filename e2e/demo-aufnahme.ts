import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { type APIResponse, expect, type Page } from "@playwright/test";
import { type Aufgenommen, type Aufnahme, GRUPPEN, schluessel } from "../src/demo/aufnahme.ts";

/*
 * Nimmt die Antworten des Servers für die Demo auf (docs/entwicklung.md, Demo): nach den Bildern (e2e/screenshots.ts),
 * mit denselben erfundenen Daten. Jede Seite, jeder Reiter und jedes Dokument wird einmal besucht; was die App dabei
 * abfragt, landet in demo/aufnahme.json, Dateien (PDF, Vorschaubilder, Seiten) in demo/dateien/. Die Listen der
 * Dokumente kommen je Gruppe ganz, die Demo filtert und blättert sie selbst (src/demo/antworten.ts).
 */

const ZIEL = "demo";

const SEITEN = [
  "/",
  "/eingang",
  "/archiv",
  "/ordnung",
  "/ordnung?bereich=tags",
  "/ordnung?bereich=typen",
  "/ordnung?bereich=felder",
  "/fristen",
  "/fristen?bereich=sperren",
  "/fristen?bereich=vorlagen",
  "/pruefung",
  "/quellen",
  "/quellen?bereich=scannen",
  "/quellen?bereich=umzug",
  "/quellen?bereich=schnittstelle",
  "/workflows",
  "/verfahrensdoku?bereich=angaben",
  "/verfahrensdoku?bereich=dokument",
  "/zugaenge",
  "/konto",
  "/benachrichtigungen",
];
const DOKUMENT_REITER = ["einordnung", "notizen", "weiteres", "verlauf"];

const ENDUNG: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
  "message/rfc822": "eml",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/html": "html",
};

/** Was Response (aus der Seite) und APIResponse (page.request) gemeinsam haben */
type Antwort = Pick<APIResponse, "url" | "status" | "headers" | "body">;

async function sichern(antworten: Aufnahme["antworten"], res: Antwort) {
  const url = new URL(res.url());
  if (!url.pathname.startsWith("/api/")) return;
  // Die Liste der Dokumente nimmt die Aufnahme je Gruppe ganz auf (unten)
  if (url.pathname === "/api/dokumente") return;
  const status = res.status();
  if (status >= 300 && status < 400) return;
  // Lädt Chromiums PDF-Ansicht die Datei, fehlen die Kopfzeilen und der Inhalt ist ihre HTML-Hülle: überspringen, die
  // Datei holt demoAufnehmen selbst
  const typ = (res.headers()["content-type"] ?? "").split(";")[0]!.trim();
  if (!typ) return;
  let body: Buffer;
  try {
    body = await res.body();
  } catch {
    return;
  }
  const key = schluessel(url.pathname, url.search);
  let eintrag: Aufgenommen;
  if (typ === "application/json") eintrag = { status, json: JSON.parse(body.toString("utf8") || "null") };
  else {
    const name = `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.${ENDUNG[typ] ?? "bin"}`;
    await writeFile(`${ZIEL}/dateien/${name}`, body);
    eintrag = { status, typ, datei: name };
  }
  antworten[key] = eintrag;
}

/** Nach vorbereiten() und den Bildern: alles, was die Demo zeigt, mit dem Stand dieser Datenbank */
export async function demoAufnehmen(page: Page) {
  await rm(`${ZIEL}/dateien`, { recursive: true, force: true });
  await mkdir(`${ZIEL}/dateien`, { recursive: true });
  const antworten: Aufnahme["antworten"] = {};
  const offen = new Set<Promise<void>>();
  const merken = (res: Antwort) => {
    const p = sichern(antworten, res).finally(() => offen.delete(p));
    offen.add(p);
  };
  const ausSeite = (res: Antwort & { request(): { method(): string } }) => {
    if (res.request().method() === "GET") merken(res);
  };
  page.on("response", ausSeite);

  const besuchen = async (pfad: string) => {
    await page.goto(pfad);
    await expect(page.locator("h1").first()).toBeAttached();
    await page.waitForLoadState("networkidle");
  };
  for (const pfad of SEITEN) await besuchen(pfad);

  const listen: Aufnahme["listen"] = {};
  for (const gruppe of GRUPPEN) {
    const res = await page.request.get(`/api/dokumente?gruppe=${gruppe}&proSeite=200&sortierung=neu`);
    listen[gruppe] = await res.json();
  }
  for (const d of listen.alle ?? []) {
    for (const reiter of DOKUMENT_REITER) await besuchen(`/dokumente/${d.id}?reiter=${reiter}`);
    // Das Original zum Herunterladen und für die Vorschau: in der Seite lädt Chromiums PDF-Ansicht es und liefert
    // statt der Datei ihre eigene HTML-Hülle
    merken(await page.request.get(`/api/dokumente/${d.id}/datei`));
    merken(await page.request.get(`/api/dokumente/${d.id}/datei?ansicht=1`));
  }
  page.off("response", ausSeite);
  await Promise.all(offen);

  const aufnahme: Aufnahme = {
    stand: new Date().toISOString(),
    listen,
    antworten: Object.fromEntries(Object.entries(antworten).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(`${ZIEL}/aufnahme.json`, `${JSON.stringify(aufnahme, null, 1)}\n`);
}
