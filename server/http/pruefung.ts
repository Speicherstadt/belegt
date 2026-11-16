import { dateienPruefen, pruefen } from "../dokumente/dokumente.ts";
import {
  EinstellungenEingabe,
  laden as einstellungenLaden,
  speichern as einstellungenSpeichern,
} from "../einstellungen/einstellungen.ts";
import { z3Export } from "../export/z3.ts";
import { bericht } from "../pruefung/bericht.ts";
import { verfahrensdoku } from "../verfahrensdoku/verfahrensdoku.ts";
import { listen as zeitstempelListen, token as zeitstempelToken } from "../zeitstempel/zeitstempel.ts";
import { schnitt } from "../zugang/pruefer.ts";

import { type App, type AppUmgebung, akteur, Id, VERSION, Zeitraum } from "./gemeinsam.ts";

export function pruefungRouten(app: App, umgebung: AppUmgebung) {
  // Angaben zum Betrieb: lesen dürfen Inhaber und Steuerberatung, ändern nur der Inhaber
  app.get("/api/einstellungen", async (c) => c.json(await einstellungenLaden(umgebung.db)));

  app.post("/api/einstellungen", async (c) => {
    const eingabe = EinstellungenEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültige Angaben", details: eingabe.error.issues }, 400);
    return c.json(await einstellungenSpeichern(umgebung.db, eingabe.data, akteur(c.get("nutzer"))));
  });

  app.get("/api/verfahrensdoku", async (c) =>
    c.json(
      await verfahrensdoku(umgebung.db, {
        abrufMinuten: umgebung.abrufMinuten ?? 5,
        version: VERSION,
        objektsperre: umgebung.objektsperre ?? false,
        kiModell: umgebung.kiModell,
        eingangsordner: umgebung.eingangsordner ?? false,
        trennblattCode: umgebung.trennblattCode,
        erechnungPruefung: umgebung.erechnungPruefung ?? false,
        mail: !!umgebung.mail,
      }),
    ),
  );

  app.get("/api/export", async (c) => {
    const zeitraum = Zeitraum.safeParse({ von: c.req.query("von"), bis: c.req.query("bis") });
    if (!zeitraum.success || zeitraum.data.von > zeitraum.data.bis)
      return c.json({ fehler: "Zeitraum mit von und bis (JJJJ-MM-TT) angeben" }, 400);
    // Der Prüfer bekommt nur den Teil, der in seinem Zeitraum liegt
    const freigabe = c.get("nutzer").zeitraum;
    const teil = freigabe ? schnitt(zeitraum.data, freigabe) : zeitraum.data;
    if (!teil) return c.json({ fehler: "Der Zeitraum liegt außerhalb der Freigabe" }, 403);
    // Für den Prüfer nur die Einträge des Audit-Logs zu Dokumenten seiner Freigabe
    const stream = await z3Export(umgebung, teil, { nurFreigabe: !!freigabe });
    return c.body(stream, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="belegt-z3-${teil.von}-${teil.bis}.zip"`,
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get("/api/zeitstempel", async (c) => c.json(await zeitstempelListen(umgebung.db)));

  app.get("/api/zeitstempel/:id/token", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const z = id.success ? await zeitstempelToken(umgebung.db, id.data) : null;
    if (!z) return c.json({ fehler: "Nicht gefunden" }, 404);
    // Prüfen etwa mit: openssl ts -verify -token_in -in <Datei> -digest <hash> -CAfile <Zertifikat des Dienstes>
    return c.body(new Uint8Array(z.token), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="zeitstempel-${z.seq}.tst"`,
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get("/api/pruefung", async (c) => {
    // Der Bericht vor den Befunden: sein Prüfwert ist der Stand, den die Prüfung danach bestätigt
    const kopf = await bericht(umgebung.db);
    const befunde = await pruefen(umgebung.db);
    // ?dateien=1 liest zusätzlich jede Datei und vergleicht sie mit ihrem Hash
    if (c.req.query("dateien") === "1") {
      const dateien = await dateienPruefen(umgebung);
      const alle = [...befunde, ...dateien.befunde];
      return c.json({ ok: alle.length === 0, befunde: alle, dateienGeprueft: dateien.geprueft, bericht: kopf });
    }
    return c.json({ ok: befunde.length === 0, befunde, bericht: kopf });
  });
}
