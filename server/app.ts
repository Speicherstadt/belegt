import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eingerichtet } from "./db/status.ts";
import { archivansichtenRouten } from "./http/archivansichten.ts";
import { benachrichtigungenRouten } from "./http/benachrichtigungen.ts";
import { betriebRouten } from "./http/betrieb.ts";
import { mitClientIp } from "./http/client-ip.ts";
import { dokumenteRouten } from "./http/dokumente.ts";
import { freigabeRouten } from "./http/freigabe.ts";
import { fristvorlagenRouten } from "./http/fristvorlagen.ts";
import { type App, type AppUmgebung, MAX_UPLOAD, VERSION } from "./http/gemeinsam.ts";
import { kontoRouten } from "./http/konto.ts";
import { mailRouten } from "./http/mail.ts";
import { notizenRouten } from "./http/notizen.ts";
import { oauthRouten } from "./http/oauth.ts";
import { openapi } from "./http/openapi.ts";
import { ordnungRouten } from "./http/ordnung.ts";
import { EXPORT_PFAD, paperlessRouten } from "./http/paperless.ts";
import { pruefungRouten } from "./http/pruefung.ts";
import { quellenRouten } from "./http/quellen.ts";
import { schnittstelleRouten } from "./http/schnittstelle.ts";
import { seitenRouten } from "./http/seiten.ts";
import { startRouten } from "./http/start.ts";
import { statischRouten } from "./http/statisch.ts";
import { teilenRouten } from "./http/teilen.ts";
import { workflowsRouten } from "./http/workflows.ts";
import { zugangRouten } from "./http/zugang.ts";
import { offen as einladungOffen } from "./zugang/einladungen.ts";

export { MAX_UPLOAD } from "./http/gemeinsam.ts";

/**
 * Die HTTP-Schnittstelle; ohne Bun.serve, damit Tests sie direkt mit app.request aufrufen. Ohne Umgebung (Datenbank,
 * Speicher, Anmeldung) antworten nur /healthz und 404. Alles unter /api außer /api/auth verlangt eine Sitzung;
 * schreiben darf nur der Inhaber, Steuerberatung und Prüfer lesen. Die Routen liegen nach Bereich in server/http/.
 */
export function createApp(umgebung?: AppUmgebung) {
  const app: App = new Hono();

  /** Für Container und Überwachung: antwortet, sobald der Server läuft */
  app.get("/healthz", (c) => c.json({ ok: true }));

  if (umgebung) {
    const { auth } = umgebung;
    // Better Auth bekommt die Adresse aus der Verbindung, nie aus einem Header des Clients (server/http/client-ip.ts)
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(mitClientIp(c.req.raw, umgebung.clientIp?.(c.req.raw))));

    /** Öffentlich: Beschreibung der Schnittstelle für Programme */
    app.get("/api/openapi.json", (c) => c.json(openapi));

    /** Öffentlich: ob es schon einen Inhaber gibt (Anmelden oder Einrichten), dazu die Version */
    app.get("/api/status", async (c) =>
      c.json({
        eingerichtet: await eingerichtet(umgebung.db),
        oidc: umgebung.oidcName ? { name: umgebung.oidcName } : null,
        embedOrigin: umgebung.embedOrigin ?? null,
        version: VERSION,
        oeffnenMit: umgebung.oeffnenMit ? { name: umgebung.oeffnenMit.name } : null,
        erechnungPruefung: !!umgebung.erechnungPruefung,
      }),
    );

    /** Öffentlich: ob ein Einladungslink noch gilt und für welche Rolle (Seite /einladung/…) */
    app.get("/api/einladung/:token", async (c) => {
      const e = await einladungOffen(umgebung.db, c.req.param("token"));
      return e ? c.json(e) : c.json({ fehler: "Die Einladung ist ungültig, abgelaufen oder schon eingelöst." }, 404);
    });

    // Bun nimmt für den Export aus Paperless-ngx große Anfragen an (server/index.ts); alle anderen bleiben bei der Grenze
    // für Uploads, auch die, die selbst keine setzen
    const grenze = bodyLimit({
      maxSize: MAX_UPLOAD + 1024 * 1024,
      onError: (c) => c.json({ fehler: "Anfrage zu groß" }, 413),
    });
    app.use("/api/*", (c, next) => (c.req.path === EXPORT_PFAD ? next() : grenze(c, next)));

    // Zuerst die Anmeldung (Middleware), dann die Bereiche
    zugangRouten(app, umgebung);
    kontoRouten(app, umgebung);
    dokumenteRouten(app, umgebung);
    archivansichtenRouten(app, umgebung);
    startRouten(app, umgebung);
    workflowsRouten(app, umgebung);
    fristvorlagenRouten(app, umgebung);
    seitenRouten(app, umgebung);
    notizenRouten(app, umgebung);
    ordnungRouten(app, umgebung);
    freigabeRouten(app, umgebung);
    teilenRouten(app, umgebung);
    mailRouten(app, umgebung);
    quellenRouten(app, umgebung);
    pruefungRouten(app, umgebung);
    betriebRouten(app, umgebung);
    benachrichtigungenRouten(app, umgebung);
    schnittstelleRouten(app, umgebung);
    oauthRouten(app, umgebung);
    paperlessRouten(app, umgebung);
    if (umgebung.oberflaeche) statischRouten(app, umgebung.oberflaeche, umgebung.embedOrigin);
  }

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
