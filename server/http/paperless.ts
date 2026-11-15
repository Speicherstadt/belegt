import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "hono";
import {
  abbrechen,
  apiLaufStarten,
  exportLaufAnlegen,
  exportPfad,
  fehlerListen,
  istBelegt,
  laeufeListen,
  QuelleEingabe,
  quelleAnlegen,
  quellenListen,
  ZuordnungEingabe,
  zuordnungAnlegen,
  zuordnungenListen,
  zuordnungLoeschen,
} from "../paperless/laeufe.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/** Pfad des Uploads eines Exports; für ihn gilt die Grenze IMPORT_MAX_GB statt der für andere Anfragen */
export const EXPORT_PFAD = "/api/paperless/export";

/** Vorgabe für die größte Datei eines Exports */
export const IMPORT_MAX = 20 * 1024 * 1024 * 1024;

/** Ein ZIP beginnt mit dem lokalen Kopf seines ersten Eintrags (APPNOTE.TXT 4.3.7) */
const istZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * Schreibt den Körper der Anfrage Stück für Stück in eine Datei, ohne ihn in den Speicher zu laden; bricht bei mehr als
 * max Bytes ab und entfernt die Datei. Antwort: die Größe, oder ein Fehler für die Antwort.
 */
async function stromInDatei(koerper: ReadableStream<Uint8Array> | null, ziel: string, max: number) {
  if (!koerper) return { fehler: "Keine Datei", status: 400 as const };
  const datei = await open(ziel, "w");
  let groesse = 0;
  let kopf = new Uint8Array();
  const leser = koerper.getReader();
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      groesse += value.byteLength;
      if (groesse > max) {
        await leser.cancel();
        return { fehler: "Datei zu groß", status: 413 as const };
      }
      if (kopf.length < 4) kopf = new Uint8Array([...kopf, ...value.subarray(0, 4 - kopf.length)]);
      await datei.write(value);
    }
  } finally {
    await datei.close();
  }
  if (!istZip(kopf))
    return { fehler: "Kein ZIP-Archiv; erwartet ist ein Export mit document_exporter --zip", status: 400 as const };
  return { groesse };
}

/** Der Umzug ist Sache des Inhabers mit Sitzung; Steuerberatung und Prüfer sehen ihn nicht, Tokens erreichen ihn nicht */
const nurInhaber = (c: Context) =>
  c.get("nutzer").role === "inhaber" && !c.get("nutzer").token ? null : c.json({ fehler: "Nur für den Inhaber" }, 403);

/** Quellen, Start über die API und Upload eines Exports; dazu die Läufe */
export function paperlessRouten(app: App, umgebung: AppUmgebung) {
  const { db } = umgebung;

  app.get("/api/paperless/quellen", async (c) => nurInhaber(c) ?? c.json(await quellenListen(db)));

  app.post("/api/paperless/quellen", async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    if (!umgebung.schluessel) return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const e = QuelleEingabe.safeParse(await c.req.json().catch(() => null));
    if (!e.success)
      return c.json(
        { fehler: "Ungültige Quelle", details: e.error.issues.map((i) => ({ path: i.path, message: i.message })) },
        400,
      );
    return c.json(await quelleAnlegen(db, umgebung.schluessel, e.data, akteur(c.get("nutzer"))), 201);
  });

  app.post("/api/paperless/quellen/:id/starten", async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    const id = Id.safeParse(c.req.param("id"));
    try {
      const lauf = id.success ? await apiLaufStarten(db, id.data, akteur(c.get("nutzer"))) : null;
      return lauf ? c.json(lauf, 201) : c.json({ fehler: "Nicht gefunden" }, 404);
    } catch (err) {
      if (!istBelegt(err)) throw err;
      return c.json({ fehler: err.message }, 409);
    }
  });

  app.post(EXPORT_PFAD, async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    const ordner = umgebung.importOrdner;
    if (!ordner) return c.json({ fehler: "IMPORT_ORDNER fehlt auf dem Server" }, 503);
    await mkdir(ordner, { recursive: true });
    const teil = join(ordner, `upload-${randomUUID()}.teil`);
    try {
      const r = await stromInDatei(c.req.raw.body, teil, umgebung.importMax ?? IMPORT_MAX);
      if ("fehler" in r) return c.json({ fehler: r.fehler }, r.status);
      const name = c.req.query("name")?.trim() || null;
      const lauf = await exportLaufAnlegen(db, name, akteur(c.get("nutzer")), (importId) =>
        rename(teil, exportPfad(ordner, importId)),
      );
      return c.json(lauf, 201);
    } finally {
      await rm(teil, { force: true });
    }
  });

  laeufeRouten(app, umgebung);
}

/** Stand, Fehler und Abbrechen der Läufe, Zuordnungen zur Art */
function laeufeRouten(app: App, umgebung: AppUmgebung) {
  const { db } = umgebung;
  app.get("/api/paperless/importe", async (c) => nurInhaber(c) ?? c.json(await laeufeListen(db)));

  app.get("/api/paperless/importe/:id/fehler", async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    const id = Id.safeParse(c.req.param("id"));
    return c.json(id.success ? await fehlerListen(db, id.data) : []);
  });

  app.post("/api/paperless/importe/:id/abbrechen", async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await abbrechen(db, id.data, akteur(c.get("nutzer")), umgebung.importOrdner));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein laufender Import mit dieser ID" }, 404);
  });

  app.get("/api/paperless/zuordnungen", async (c) => nurInhaber(c) ?? c.json(await zuordnungenListen(db)));

  app.post("/api/paperless/zuordnungen", async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    const e = ZuordnungEingabe.safeParse(await c.req.json().catch(() => null));
    if (!e.success) return c.json({ fehler: "art (dokumenttyp oder tag), name und zielArt angeben" }, 400);
    try {
      return c.json(await zuordnungAnlegen(db, e.data, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      if (!istBelegt(err)) throw err;
      return c.json({ fehler: err.message }, 409);
    }
  });

  app.delete("/api/paperless/zuordnungen/:id", async (c) => {
    const verboten = nurInhaber(c);
    if (verboten) return verboten;
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await zuordnungLoeschen(db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
