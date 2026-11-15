import { Hono } from "hono";
import { eingerichtet } from "./db/status.ts";
import { dokumenteRouten } from "./http/dokumente.ts";
import { freigabeRouten } from "./http/freigabe.ts";
import { type App, type AppUmgebung, VERSION } from "./http/gemeinsam.ts";
import { mailRouten } from "./http/mail.ts";
import { oauthRouten } from "./http/oauth.ts";
import { openapi } from "./http/openapi.ts";
import { ordnungRouten } from "./http/ordnung.ts";
import { pruefungRouten } from "./http/pruefung.ts";
import { schnittstelleRouten } from "./http/schnittstelle.ts";
import { seitenRouten } from "./http/seiten.ts";
import { statischRouten } from "./http/statisch.ts";
import { teilenRouten } from "./http/teilen.ts";
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
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

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
      }),
    );

    /** Öffentlich: ob ein Einladungslink noch gilt und für welche Rolle (Seite /einladung/…) */
    app.get("/api/einladung/:token", async (c) => {
      const e = await einladungOffen(umgebung.db, c.req.param("token"));
      return e ? c.json(e) : c.json({ fehler: "Die Einladung ist ungültig, abgelaufen oder schon eingelöst." }, 404);
    });

    // Zuerst die Anmeldung (Middleware), dann die Bereiche
    zugangRouten(app, umgebung);
    dokumenteRouten(app, umgebung);
    seitenRouten(app, umgebung);
    ordnungRouten(app, umgebung);
    freigabeRouten(app, umgebung);
    teilenRouten(app, umgebung);
    mailRouten(app, umgebung);
    pruefungRouten(app, umgebung);
    schnittstelleRouten(app, umgebung);
    oauthRouten(app, umgebung);
    if (umgebung.oberflaeche) statischRouten(app, umgebung.oberflaeche, umgebung.embedOrigin);
  }

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
