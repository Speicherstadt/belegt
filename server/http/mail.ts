import { bodyLimit } from "hono/body-limit";
import { zuordnungVorschlagZu } from "../abgleich/vorschlaege.ts";
import { inhaltZu } from "../inhalt/inhalt.ts";
import { kiVorschlagZu } from "../ki/vorschlaege.ts";
import { gelerntInSicht, gelerntVorschlagZu } from "../lernen/lernen.ts";
import { gelerntOhneDoppelte } from "../lernen/reihenfolge.ts";
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
}
