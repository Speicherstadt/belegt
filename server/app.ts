import { Hono } from "hono";
import { eingerichtet } from "./db/status.ts";
import { dokumenteRouten } from "./http/dokumente.ts";
import type { App, AppUmgebung } from "./http/gemeinsam.ts";
import { mailRouten } from "./http/mail.ts";
import { pruefungRouten } from "./http/pruefung.ts";
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

    /** Öffentlich: ob es schon einen Inhaber gibt (Anmelden oder Einrichten) */
    app.get("/api/status", async (c) => c.json({ eingerichtet: await eingerichtet(umgebung.db) }));

    /** Öffentlich: ob ein Einladungslink noch gilt und für welche Rolle (Seite /einladung/…) */
    app.get("/api/einladung/:token", async (c) => {
      const e = await einladungOffen(umgebung.db, c.req.param("token"));
      return e ? c.json(e) : c.json({ fehler: "Die Einladung ist ungültig, abgelaufen oder schon eingelöst." }, 404);
    });

    // Zuerst die Anmeldung (Middleware), dann die Bereiche
    zugangRouten(app, umgebung);
    dokumenteRouten(app, umgebung);
    mailRouten(app, umgebung);
    pruefungRouten(app, umgebung);
  }

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
