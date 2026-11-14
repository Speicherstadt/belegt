import { bodyLimit } from "hono/body-limit";
import { inhaltZu } from "../inhalt/inhalt.ts";
import { kiVorschlagZu } from "../ki/vorschlaege.ts";
import {
  abrufen,
  QuelleEingabe,
  anlegen as quelleAnlegen,
  listen as quellenListen,
  aktivSetzen as quelleSchalten,
} from "../mail/abruf.ts";
import { importieren, mailZuDokument } from "../mail/import.ts";
import {
  aktivSetzen,
  RegelEingabe,
  anlegen as regelAnlegen,
  listenMitOrdnung as regelnListen,
  vorschlag,
} from "../mail/regeln.ts";
import { istKonflikt } from "../ordnung/ordnung.ts";
import { imZeitraum } from "../zugang/pruefer.ts";

import { type App, type AppUmgebung, akteur, Id, MAX_UPLOAD } from "./gemeinsam.ts";

export function mailRouten(app: App, umgebung: AppUmgebung) {
  app.post(
    "/api/mails",
    bodyLimit({ maxSize: MAX_UPLOAD, onError: (c) => c.json({ fehler: "Datei zu groß" }, 413) }),
    async (c) => {
      const datei = (await c.req.formData()).get("datei");
      if (!(datei instanceof File)) return c.json({ fehler: "Feld „datei“ fehlt (.eml oder MBOX)" }, 400);
      const ergebnis = await importieren(
        umgebung,
        new Uint8Array(await datei.arrayBuffer()),
        akteur(c.get("nutzer")),
        datei.name || null,
      );
      return c.json(ergebnis, 201);
    },
  );

  app.get("/api/dokumente/:id/mail", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const mail = id.success ? await mailZuDokument(umgebung.db, id.data) : null;
    if (!mail) return c.json({ fehler: "Keine Mail" }, 404);
    const zeitraum = c.get("nutzer").zeitraum;
    if (!zeitraum) return c.json(mail);
    // Der Prüfer sieht von Unterhaltung, Anhängen und Mail nur, was im Zeitraum liegt
    const sichtbar = await imZeitraum(
      umgebung.db,
      [...mail.unterhaltung.map((u) => u.dokumentId), ...mail.anhaenge.map((a) => a.dokumentId), mail.ausMail ?? ""],
      zeitraum,
    );
    // Kopf und Text gehören der Mail: Liegt sie zu einem Anhang außerhalb des Zeitraums, gibt es für ihn keine Mail
    if (mail.ausMail && !sichtbar.has(mail.ausMail)) return c.json({ fehler: "Keine Mail" }, 404);
    return c.json({
      ...mail,
      unterhaltung: mail.unterhaltung.filter((u) => sichtbar.has(u.dokumentId)),
      anhaenge: mail.anhaenge.filter((a) => sichtbar.has(a.dokumentId)),
    });
  });

  app.get("/api/dokumente/:id/vorschlag", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ vorschlag: null, erechnung: null, ki: null });
    // Dazu die Kopfdaten einer erkannten E-Rechnung: Datum, Nummer und Verkäufer für die Einordnung
    const [regel, inhalt, ki] = await Promise.all([
      vorschlag(umgebung.db, id.data),
      inhaltZu(umgebung.db, id.data),
      kiVorschlagZu(umgebung.db, id.data),
    ]);
    // ki: Vorschlag des Sprachmodells (nur mit KI_URL); übernommen wird nur, was ein Mensch bestätigt
    return c.json({ vorschlag: regel, erechnung: inhalt?.erechnung ?? null, ki });
  });

  app.get("/api/regeln", async (c) => c.json(await regelnListen(umgebung.db)));

  app.post("/api/regeln", async (c) => {
    const eingabe = RegelEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültige Regel", details: eingabe.error.issues }, 400);
    try {
      return c.json(await regelAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      // Unbekannter Tag, Dokumenttyp oder Feld im Vorschlag, oder ein Wert, der nicht zum Feld passt
      if (!istKonflikt(err)) throw err;
      return c.json({ fehler: err.message }, "ungueltig" in err ? 400 : 409);
    }
  });

  app.post("/api/regeln/:id/:schalter{aktivieren|deaktivieren}", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const r = id.success
      ? await aktivSetzen(umgebung.db, id.data, c.req.param("schalter") === "aktivieren", akteur(c.get("nutzer")))
      : null;
    return r ? c.json(r) : c.json({ fehler: "Nicht gefunden" }, 404);
  });

  // Postfächer: das Passwort geht nur hinein, nie hinaus; ohne BELEGT_SCHLUESSEL lassen sie sich nicht anlegen
  app.get("/api/quellen", async (c) => c.json(await quellenListen(umgebung.db)));

  app.post("/api/quellen", async (c) => {
    if (!umgebung.schluessel) return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const eingabe = QuelleEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success)
      return c.json(
        {
          fehler: "Ungültige Quelle",
          details: eingabe.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    return c.json(await quelleAnlegen(umgebung.db, umgebung.schluessel, eingabe.data, akteur(c.get("nutzer"))), 201);
  });

  app.post("/api/quellen/:id/abrufen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    if (!umgebung.schluessel || !umgebung.oeffnen)
      return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    return c.json(
      await abrufen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen, {
        oauth: umgebung.oauth,
        abfragen: umgebung.abfragen,
      }),
    );
  });

  app.post("/api/quellen/:id/:schalter{aktivieren|deaktivieren}", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const q = id.success
      ? await quelleSchalten(umgebung.db, id.data, c.req.param("schalter") === "aktivieren", akteur(c.get("nutzer")))
      : null;
    return q ? c.json(q) : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
