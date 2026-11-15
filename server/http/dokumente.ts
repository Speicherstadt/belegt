import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ansichtZu, hatAnsicht } from "../ansicht/ansicht.ts";
import { anzahl, aufnehmen, laden, listen, verlauf } from "../dokumente/dokumente.ts";
import {
  aktuelle,
  EinordnungEingabe,
  einordnen,
  Gruppe,
  SperreEingabe,
  sperreAnlegen,
  sperreAufheben,
  sperrenListen,
  uebersicht,
} from "../einordnung/einordnung.ts";
import { inhaltZu } from "../inhalt/inhalt.ts";
import {
  beantragen,
  bestaetigen,
  fuerDokument,
  listen as loeschungenListen,
  zurueckziehen as loeschungZurueckziehen,
  regelVerletzt,
} from "../loeschung/loeschung.ts";
import { filterAus } from "../ordnung/filter.ts";
import { felderListen } from "../ordnung/ordnung.ts";
import { ordnungZu } from "../ordnung/zuordnung.ts";
import { TRENNBLATT_CODE, trennblattPdf } from "../trennen/trennblatt.ts";
import { begrenzt, dateiTeilen } from "../trennen/trennen.ts";
import { vorschaubildZu } from "../vorschaubild/vorschaubild.ts";

import { ANSICHT, type App, type AppUmgebung, akteur, dateinameKodiert, heute, Id, MAX_UPLOAD } from "./gemeinsam.ts";

/** Nummer einer Seite der Liste, ab 1 */
const Seite = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));

export function dokumenteRouten(app: App, umgebung: AppUmgebung) {
  // Teilen kostet CPU: höchstens zwei Stapel zugleich, vier warten. Ungeteilt aufnehmen wäre keine Ausweichlösung,
  // denn ein aufgenommener Stapel bleibt als Original; darüber hinaus antwortet der Upload mit 503
  const teilenTor = begrenzt(2, 4);
  app.post(
    "/api/dokumente",
    bodyLimit({ maxSize: MAX_UPLOAD, onError: (c) => c.json({ fehler: "Datei zu groß" }, 413) }),
    async (c) => {
      const form = await c.req.formData();
      const datei = form.get("datei");
      if (!(datei instanceof File)) return c.json({ fehler: "Feld „datei“ fehlt" }, 400);
      const bytes = new Uint8Array(await datei.arrayBuffer());
      const eingang = { quelle: "upload" as const, akteur: akteur(c.get("nutzer")) };
      if (c.req.query("trennen") !== "1")
        return c.json(await aufnehmen(umgebung, { ...eingang, bytes, dateiname: datei.name || null }), 201);
      // Ein Stapel mit Trennblättern: jedes Teil ein eigenes Original. Geteilt wird in einem eigenen Prozess; scheitert
      // es (kaputtes PDF, Zeitlimit), kommt die Datei unverändert ins Archiv, wie ohne Trennblatt
      const name = datei.name || "scan.pdf";
      const geteilt = await teilenTor(async () => ({
        teile: await dateiTeilen(bytes, name, {
          code: umgebung.trennblattCode ?? TRENNBLATT_CODE,
          zeitlimit: 2 * 60_000,
        }).catch(() => null),
      }));
      if (!geteilt)
        return c.json({ fehler: "Belegt teilt gerade andere Stapel; bitte gleich noch einmal" }, 503, {
          "Retry-After": "60",
        });
      const { teile } = geteilt;
      const dokumente = [];
      for (const teil of teile ?? [{ bytes, dateiname: datei.name || null }])
        dokumente.push(await aufnehmen(umgebung, { ...eingang, ...teil }));
      return c.json({ dokumente }, 201);
    },
  );

  /** Ein Trennblatt zum Ausdrucken: Belegt teilt gescannte Stapel an dieser Seite */
  app.get("/api/trennblatt.pdf", async (c) =>
    c.body(new Uint8Array(await trennblattPdf(umgebung.trennblattCode ?? TRENNBLATT_CODE)), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=trennblatt.pdf",
    }),
  );

  // Seiten: seite (ab 1) und proSeite (limit ist ein anderer Name dafür); die Gesamtzahl steht in X-Gesamt, damit der
  // Rumpf eine Liste bleibt wie vorher
  app.get("/api/dokumente", async (c) => {
    const proSeite = Math.min(
      Math.max(Math.trunc(Number(c.req.query("proSeite") ?? c.req.query("limit") ?? 50)) || 50, 1),
      200,
    );
    const seite = Seite.safeParse(c.req.query("seite") ?? "1");
    if (!seite.success) return c.json({ fehler: "Ungültige Seite" }, 400);
    const gruppe = Gruppe.catch("alle").parse(c.req.query("gruppe") ?? "alle");
    const parameter = c.req.queries();
    const felder = Object.keys(parameter).some((k) => k.startsWith("feld.")) ? await felderListen(umgebung.db) : [];
    const ordnung = filterAus(parameter, felder);
    if (!ordnung) return c.json({ fehler: "Ungültiger Filter" }, 400);
    const abfrage = {
      suche: c.req.query("suche"),
      gruppe,
      heute: heute(),
      zeitraum: c.get("nutzer").zeitraum,
      ordnung,
      notizen: !c.get("nutzer").zeitraum,
    };
    const [eintraege, gesamt] = await Promise.all([
      listen(umgebung.db, { ...abfrage, limit: proSeite, versatz: (seite.data - 1) * proSeite }),
      anzahl(umgebung.db, abfrage),
    ]);
    c.header("X-Gesamt", String(gesamt));
    return c.json(eintraege);
  });

  app.get("/api/dokumente/:id", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json({
      ...dokument,
      einordnung: await aktuelle(umgebung.db, dokument.id),
      loeschung: await fuerDokument(umgebung.db, dokument.id),
      ansicht: await hatAnsicht(umgebung.db, dokument.id),
      ...(await ordnungZu(umgebung.db, dokument.id)),
    });
  });

  app.post("/api/dokumente/:id/einordnung", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    const eingabe = EinordnungEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültige Einordnung", details: eingabe.error.issues }, 400);
    try {
      return c.json(await einordnen(umgebung.db, dokument.id, eingabe.data, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      // Ein Trigger lehnt ab (etwa: schon gelöscht); seine Meldung ist für Menschen geschrieben
      const meldung = regelVerletzt(err);
      if (meldung) return c.json({ fehler: meldung }, 409);
      // fristende lehnt etwa einen Tag ab, den es nicht gibt, oder freiwillig ohne Datum; Datenbankfehler (mit cause
      // oder code) gehen nie mit ihrem Text an den Aufrufer, sie könnten SQL enthalten
      if (err instanceof Error && !("code" in err) && !("cause" in err && err.cause))
        return c.json({ fehler: err.message }, 400);
      throw err;
    }
  });

  app.post("/api/dokumente/:id/loeschung", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    if (await fuerDokument(umgebung.db, dokument.id))
      return c.json({ fehler: "Für dieses Dokument gibt es schon eine Löschung" }, 409);
    try {
      return c.json(await beantragen(umgebung.db, umgebung.speicher, dokument.id, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      const meldung = regelVerletzt(err);
      if (meldung) return c.json({ fehler: meldung }, 409);
      throw err;
    }
  });

  app.get("/api/loeschungen", async (c) => c.json(await loeschungenListen(umgebung.db)));

  app.post("/api/loeschungen/:id/bestaetigen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    try {
      const l = await bestaetigen(umgebung.db, umgebung.speicher, id.data, akteur(c.get("nutzer")));
      return l ? c.json(l) : c.json({ fehler: "Kein offener Antrag mit dieser ID" }, 404);
    } catch (err) {
      const meldung = regelVerletzt(err);
      if (meldung) return c.json({ fehler: meldung }, 409);
      throw err;
    }
  });

  app.delete("/api/loeschungen/:id", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await loeschungZurueckziehen(umgebung.db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein offener Antrag mit dieser ID" }, 404);
  });

  app.get("/api/sperren", async (c) => c.json(await sperrenListen(umgebung.db)));

  app.post("/api/sperren", async (c) => {
    const eingabe = SperreEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültige Sperre", details: eingabe.error.issues }, 400);
    return c.json(await sperreAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer"))), 201);
  });

  app.post("/api/sperren/:id/aufheben", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const sperre = id.success ? await sperreAufheben(umgebung.db, id.data, akteur(c.get("nutzer"))) : null;
    return sperre ? c.json(sperre) : c.json({ fehler: "Keine offene Sperre mit dieser ID" }, 404);
  });

  app.get("/api/fristen/uebersicht", async (c) => c.json(await uebersicht(umgebung.db, heute())));

  app.get("/api/dokumente/:id/datei", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
    const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
    // Fehlt die Datei oder passt ihr Hash nicht mehr, wird nichts ausgeliefert, was als Original gelten könnte
    if (!bytes) return c.json({ fehler: "Die Datei fehlt oder wurde verändert" }, 409);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": dokument.mimeType,
      // ?ansicht=1 zeigt PDFs und Bilder im Browser an, alles andere wird immer heruntergeladen
      "Content-Disposition": `${c.req.query("ansicht") === "1" && ANSICHT.has(dokument.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${dateinameKodiert(dokument.dateiname ?? dokument.sha256)}`,
      "X-Content-Type-Options": "nosniff",
    });
  });

  /** Die Ansicht als PDF für Office-Dateien; abgeleitet, maßgeblich bleibt die Datei */
  app.get("/api/dokumente/:id/ansicht", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
    const pdf = await ansichtZu(umgebung.db, dokument.id);
    if (!pdf) return c.json({ fehler: "Keine Ansicht" }, 404);
    const name = `${(dokument.dateiname ?? dokument.sha256).replace(/\.[^.]*$/, "")} (Ansicht).pdf`;
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${dateinameKodiert(name)}`,
      "X-Content-Type-Options": "nosniff",
    });
  });

  /** Vorschaubild der ersten Seite (JPEG); abgeleitet, ändert sich nie, solange das Dokument nicht gelöscht ist */
  app.get("/api/dokumente/:id/vorschaubild", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
    const bild = await vorschaubildZu(umgebung.db, dokument.id);
    if (!bild) return c.json({ fehler: "Kein Vorschaubild" }, 404);
    return c.body(new Uint8Array(bild), 200, {
      "Content-Type": "image/jpeg",
      // Nur im Browser der angemeldeten Person, nicht in geteilten Caches; eine Stunde, damit eine Löschung bald greift
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get("/api/dokumente/:id/inhalt", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    // null, solange der Worker die Datei noch nicht gelesen hat oder es nichts zu lesen gibt (Bilder)
    return c.json(await inhaltZu(umgebung.db, dokument.id));
  });

  app.get("/api/dokumente/:id/verlauf", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    return dokument
      ? c.json(await verlauf(umgebung.db, dokument.id, { notizen: !c.get("nutzer").zeitraum }))
      : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
