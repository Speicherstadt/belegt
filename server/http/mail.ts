import { bodyLimit } from "hono/body-limit";
import { zuordnungVorschlagZu } from "../abgleich/vorschlaege.ts";
import type { Angemeldet } from "../auth.ts";
import { inhaltZu } from "../inhalt/inhalt.ts";
import { kiVorschlagZu } from "../ki/vorschlaege.ts";
import { gelerntInSicht, gelerntVorschlagZu } from "../lernen/lernen.ts";
import { gelerntOhneDoppelte } from "../lernen/reihenfolge.ts";
import {
  abrufen,
  QuelleEingabe,
  anlegen as quelleAnlegen,
  listen as quellenListen,
  aktivSetzen as quelleSchalten,
} from "../mail/abruf.ts";
import { AktionEingabe, aktionEinstellen, ordnerListen, protokoll } from "../mail/aktionen.ts";
import { importieren, mailZuDokument } from "../mail/import.ts";
import {
  aktivSetzen,
  RegelEingabe,
  anlegen as regelAnlegen,
  listenMitOrdnung as regelnListen,
  vorschlag,
} from "../mail/regeln.ts";
import { istKonflikt, vorschlagImSichtbereich } from "../ordnung/ordnung.ts";
import { importVorschlagZu } from "../paperless/kern.ts";
import { sichtbareIds, sichtVon } from "../zugang/sicht.ts";

import { type App, type AppUmgebung, akteur, Id, MAX_UPLOAD } from "./gemeinsam.ts";

/** Aktionen im Postfach stellt nur der Inhaber mit seiner Sitzung ein, kein Programm mit Token */
const nurInhaber = (n: Angemeldet) => n.role === "inhaber" && !n.token;

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
    const sicht = sichtVon(c.get("nutzer"));
    if (!sicht) return c.json(mail);
    // Prüfer und Mitarbeiter sehen von Unterhaltung, Anhängen und Mail nur, was in ihrer Sicht liegt
    const sichtbar = await sichtbareIds(
      umgebung.db,
      [...mail.unterhaltung.map((u) => u.dokumentId), ...mail.anhaenge.map((a) => a.dokumentId), mail.ausMail ?? ""],
      sicht,
    );
    // Kopf und Text gehören der Mail: Liegt sie zu einem Anhang außerhalb der Sicht, gibt es für ihn keine Mail
    if (mail.ausMail && !sichtbar.has(mail.ausMail)) return c.json({ fehler: "Keine Mail" }, 404);
    return c.json({
      ...mail,
      unterhaltung: mail.unterhaltung.filter((u) => sichtbar.has(u.dokumentId)),
      anhaenge: mail.anhaenge.filter((a) => sichtbar.has(a.dokumentId)),
    });
  });

  app.get("/api/dokumente/:id/vorschlag", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success)
      return c.json({ vorschlag: null, zuordnung: null, gelernt: null, erechnung: null, ki: null, import: null });
    // Dazu die Kopfdaten einer erkannten E-Rechnung: Datum, Nummer und Verkäufer für die Einordnung
    const [regelRoh, zuordnungRoh, gelerntRoh, inhalt, kiRoh, aus] = await Promise.all([
      vorschlag(umgebung.db, id.data),
      zuordnungVorschlagZu(umgebung.db, id.data),
      gelerntVorschlagZu(umgebung.db, id.data),
      inhaltZu(umgebung.db, id.data),
      kiVorschlagZu(umgebung.db, id.data),
      importVorschlagZu(umgebung.db, id.data),
    ]);
    // Ein Mitarbeiter sieht nur Tags, Typen und Korrespondenten seines Sichtbereichs, auch nicht die Namen der Regeln,
    // die übersprungen wurden (server/ordnung/ordnung.ts)
    const sicht = sichtVon(c.get("nutzer"));
    const imBereich = <V extends Parameters<typeof vorschlagImSichtbereich>[0]>(v: V | null | undefined) =>
      v ? vorschlagImSichtbereich(v, sicht) : null;
    const regel = regelRoh && { ...regelRoh, ordnung: imBereich(regelRoh.ordnung) };
    const gefiltert = imBereich(zuordnungRoh);
    const zuordnung =
      gefiltert && sicht?.bereich
        ? gefiltert.tags.length || gefiltert.dokumenttyp || gefiltert.korrespondent
          ? { ...gefiltert, uebersprungen: [] }
          : null
        : gefiltert;
    const gelernt = await gelerntInSicht(umgebung.db, id.data, imBereich(gelerntRoh), sicht);
    const ki = kiRoh && { ...kiRoh, ordnung: imBereich(kiRoh.ordnung) };
    // Reihenfolge: Regel, Zuordnungsregel, gelernt, Sprachmodell (server/lernen/reihenfolge.ts). zuordnung: aus den
    // Zuordnungsregeln; gelernt: aus den eigenen Einordnungen; ki: Sprachmodell (nur mit KI_URL); import: Titel,
    // Korrespondent und Entstehung aus Paperless-ngx. Übernommen wird nur, was ein Mensch bestätigt
    return c.json({
      vorschlag: regel,
      zuordnung,
      gelernt: gelerntOhneDoppelte(gelernt, [regel ?? {}, { ordnung: zuordnung }]),
      erechnung: inhalt?.erechnung ?? null,
      ki,
      import: aus,
    });
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

  // Ordner des Kontos, für die Wahl des Zielordners beim Verschieben
  app.get("/api/quellen/:id/ordner", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    if (!umgebung.schluessel || !umgebung.oeffnen)
      return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    try {
      const ordner = await ordnerListen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen, {
        oauth: umgebung.oauth,
        abfragen: umgebung.abfragen,
      });
      return ordner ? c.json({ ordner }) : c.json({ fehler: "Nicht gefunden" }, 404);
    } catch (err) {
      return c.json({ fehler: `Postfach nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
  });

  // Aktion nach dem Abholen; verschieben nur in einen Ordner, den es gibt, löschen nur mit Bestätigung
  app.post("/api/quellen/:id/aktion", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    const eingabe = AktionEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success)
      return c.json(
        {
          fehler: eingabe.error.issues[0]?.message ?? "Ungültige Aktion",
          details: eingabe.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    // Ohne S3 mit Object Lock gibt es keine Sperre, auf die das Löschen warten könnte; es würde nie gelöscht
    if (eingabe.data.aktion === "loeschen" && eingabe.data.nachSperre && !umgebung.objektsperre)
      return c.json({ fehler: "„Erst nach Sperre“ geht nur mit S3 und Object Lock" }, 400);
    if (eingabe.data.aktion === "verschieben") {
      if (!umgebung.schluessel || !umgebung.oeffnen)
        return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
      let ordner: string[] | null;
      try {
        ordner = await ordnerListen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen, {
          oauth: umgebung.oauth,
          abfragen: umgebung.abfragen,
        });
      } catch (err) {
        return c.json(
          { fehler: `Postfach nicht erreichbar: ${err instanceof Error ? err.message : String(err)}` },
          502,
        );
      }
      if (!ordner) return c.json({ fehler: "Nicht gefunden" }, 404);
      if (!ordner.includes(eingabe.data.ziel!))
        return c.json({ fehler: `Den Ordner „${eingabe.data.ziel}“ gibt es im Postfach nicht` }, 400);
    }
    const q = await aktionEinstellen(umgebung.db, id.data, eingabe.data, akteur(c.get("nutzer")));
    if (!q) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json((await quellenListen(umgebung.db)).find((x) => x.id === q.id));
  });

  // Stand der Warteschlange und Protokoll der Aktionen
  app.get("/api/quellen/:id/aktionen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json({ ...(await protokoll(umgebung.db, id.data)), objektsperre: umgebung.objektsperre ?? false });
  });

  app.post("/api/quellen/:id/:schalter{aktivieren|deaktivieren}", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const q = id.success
      ? await quelleSchalten(umgebung.db, id.data, c.req.param("schalter") === "aktivieren", akteur(c.get("nutzer")))
      : null;
    return q ? c.json(q) : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
