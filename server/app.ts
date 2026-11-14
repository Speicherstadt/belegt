import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { darfSchreiben, type Rolle } from "../shared/rollen.ts";
import type { Angemeldet, Auth } from "./auth.ts";
import { eingerichtet } from "./db/status.ts";
import { aufnehmen, laden, listen, pruefen, type Umgebung, verlauf } from "./dokumente/dokumente.ts";
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
} from "./einordnung/einordnung.ts";

/** Typen, die der Browser gefahrlos anzeigen kann; kein SVG und kein HTML, die Skripte enthalten könnten */
const ANSICHT = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Größte Datei je Upload */
export const MAX_UPLOAD = 100 * 1024 * 1024;

const Id = z.uuid();

/** Heutiger Tag in Deutschland, für Fristen (JJJJ-MM-TT) */
const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

/** Dateiname für filename* nach RFC 8187: encodeURIComponent lässt ' ( ) * stehen, die dort nicht erlaubt sind */
const dateinameKodiert = (name: string) =>
  encodeURIComponent(name).replace(/['()*]/g, (z) => `%${z.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Ob eine schreibende Anfrage von einer fremden Seite kommt (CSRF): Das Cookie schickt der Browser auch bei Formularen
 * anderer Seiten unter derselben Domain mit. Browser setzen Origin und Sec-Fetch-Site; Aufrufe ohne beide (curl,
 * andere Programme) laufen weiter.
 */
function vonFremderSeite(headers: Headers, eigeneHerkunft: string): boolean {
  const seite = headers.get("sec-fetch-site");
  if (seite === "cross-site" || seite === "same-site") return true;
  const herkunft = headers.get("origin");
  return herkunft !== null && herkunft !== eigeneHerkunft;
}

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
    const eigeneHerkunft = new URL(auth.options.baseURL as string).origin;
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
      const schreibt = c.req.method !== "GET" && c.req.method !== "HEAD";
      if (schreibt && !darfSchreiben(nutzer.role)) return c.json({ fehler: "Diese Rolle darf nur lesen" }, 403);
      if (schreibt && vonFremderSeite(c.req.raw.headers, eigeneHerkunft)) {
        return c.json({ fehler: "Anfrage von einer fremden Seite" }, 403);
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
      const gruppe = Gruppe.catch("alle").parse(c.req.query("gruppe") ?? "alle");
      return c.json(await listen(umgebung.db, { suche: c.req.query("suche"), limit, gruppe }));
    });

    app.get("/api/dokumente/:id", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
      return c.json({ ...dokument, einordnung: await aktuelle(umgebung.db, dokument.id) });
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
        // fristende lehnt etwa einen Tag ab, den es nicht gibt, oder freiwillig ohne Datum
        if (err instanceof Error && !("code" in err)) return c.json({ fehler: err.message }, 400);
        throw err;
      }
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
      const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
      // Fehlt die Datei oder passt ihr Hash nicht mehr, wird nichts ausgeliefert, was als Original gelten könnte
      if (!bytes) return c.json({ fehler: "Die Datei fehlt oder wurde verändert" }, 409);
      return c.body(new Uint8Array(bytes), 200, {
        "Content-Type": dokument.mimeType,
        // ?ansicht=1 zeigt PDFs und Bilder im Browser an, alles andere wird immer heruntergeladen
        "Content-Disposition": `${c.req.query("ansicht") && ANSICHT.has(dokument.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${dateinameKodiert(dokument.dateiname ?? dokument.sha256)}`,
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
