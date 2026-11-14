import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { darfSchreiben, type Rolle } from "../shared/rollen.ts";
import type { Angemeldet, Auth } from "./auth.ts";
import { eingerichtet } from "./db/status.ts";
import { aufnehmen, laden, listen, pruefen, type Umgebung, verlauf } from "./dokumente/dokumente.ts";

/** Typen, die der Browser gefahrlos anzeigen kann; kein SVG und kein HTML, die Skripte enthalten könnten */
const ANSICHT = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Größte Datei je Upload */
export const MAX_UPLOAD = 100 * 1024 * 1024;

const Id = z.uuid();

/** Akteur im Audit-Log: wer angemeldet ist, mit Adresse, damit das Protokoll ohne die Tabelle user lesbar bleibt */
const akteur = (n: Angemeldet) => `nutzer:${n.email}`;

/**
 * Die HTTP-Schnittstelle; ohne Bun.serve, damit Tests sie direkt mit app.request aufrufen. Ohne Umgebung (Datenbank,
 * Speicher, Anmeldung) antworten nur /healthz und 404. Alles unter /api außer /api/auth verlangt eine Sitzung;
 * schreiben darf nur der Inhaber, Steuerberatung und Prüfer lesen.
 */
export function createApp(umgebung?: Umgebung & { auth: Auth }) {
  const app = new Hono<{ Variables: { nutzer: Angemeldet } }>();

  /** Für Container und Überwachung: antwortet, sobald der Server läuft */
  app.get("/healthz", (c) => c.json({ ok: true }));

  if (umgebung) {
    const { auth } = umgebung;
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

    /** Öffentlich: ob es schon einen Inhaber gibt (Anmelden oder Einrichten) */
    app.get("/api/status", async (c) => c.json({ eingerichtet: await eingerichtet(umgebung.db) }));

    app.use("/api/*", async (c, next) => {
      if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/status") return next();
      const sitzung = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!sitzung) return c.json({ fehler: "Nicht angemeldet" }, 401);
      const nutzer = {
        id: sitzung.user.id,
        email: sitzung.user.email,
        role: (sitzung.user as { role?: Rolle }).role ?? "pruefer",
      };
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !darfSchreiben(nutzer.role)) {
        return c.json({ fehler: "Diese Rolle darf nur lesen" }, 403);
      }
      c.set("nutzer", nutzer);
      return next();
    });

    app.get("/api/ich", (c) => c.json(c.get("nutzer")));

    app.post(
      "/api/dokumente",
      bodyLimit({ maxSize: MAX_UPLOAD, onError: (c) => c.json({ fehler: "Datei zu groß" }, 413) }),
      async (c) => {
        const form = await c.req.formData();
        const datei = form.get("datei");
        if (!(datei instanceof File)) return c.json({ fehler: "Feld „datei“ fehlt" }, 400);
        const bytes = new Uint8Array(await datei.arrayBuffer());
        const dokument = await aufnehmen(umgebung, {
          bytes,
          dateiname: datei.name || null,
          quelle: "upload",
          akteur: akteur(c.get("nutzer")),
        });
        return c.json(dokument, 201);
      },
    );

    app.get("/api/dokumente", async (c) => {
      const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
      return c.json(await listen(umgebung.db, { suche: c.req.query("suche"), limit }));
    });

    app.get("/api/dokumente/:id", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      return dokument ? c.json(dokument) : c.json({ fehler: "Nicht gefunden" }, 404);
    });

    app.get("/api/dokumente/:id/datei", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
      const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
      // Fehlt die Datei oder passt ihr Hash nicht mehr, wird nichts ausgeliefert, was als Original gelten könnte
      if (!bytes) return c.json({ fehler: "Die Datei fehlt oder wurde verändert" }, 409);
      return c.body(new Uint8Array(bytes), 200, {
        "Content-Type": dokument.mimeType,
        // ?ansicht=1 zeigt PDFs und Bilder im Browser an, alles andere wird immer heruntergeladen
        "Content-Disposition": `${c.req.query("ansicht") && ANSICHT.has(dokument.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(dokument.dateiname ?? dokument.sha256)}`,
        "X-Content-Type-Options": "nosniff",
      });
    });

    app.get("/api/dokumente/:id/verlauf", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      return dokument ? c.json(await verlauf(umgebung.db, dokument.id)) : c.json({ fehler: "Nicht gefunden" }, 404);
    });

    app.get("/api/pruefung", async (c) => {
      const befunde = await pruefen(umgebung.db);
      return c.json({ ok: befunde.length === 0, befunde });
    });
  }

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
