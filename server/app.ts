import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { aufnehmen, laden, listen, pruefen, type Umgebung } from "./dokumente/dokumente.ts";

/** Größte Datei je Upload */
export const MAX_UPLOAD = 100 * 1024 * 1024;

const Id = z.uuid();

/**
 * Die HTTP-Schnittstelle; ohne Bun.serve, damit Tests sie direkt mit app.request aufrufen. Ohne Umgebung (Datenbank,
 * Speicher) antworten nur /healthz und 404.
 *
 * Noch ohne Anmeldung: Bis sie kommt, schreibt das Audit-Log „unangemeldet“ als Akteur, und Belegt gehört nicht ins
 * Internet.
 */
export function createApp(umgebung?: Umgebung) {
  const app = new Hono();

  /** Für Container und Überwachung: antwortet, sobald der Server läuft */
  app.get("/healthz", (c) => c.json({ ok: true }));

  if (umgebung) {
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
          akteur: "unangemeldet",
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
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(dokument.dateiname ?? dokument.sha256)}`,
        "X-Content-Type-Options": "nosniff",
      });
    });

    app.get("/api/pruefung", async (c) => {
      const befunde = await pruefen(umgebung.db);
      return c.json({ ok: befunde.length === 0, befunde });
    });
  }

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
