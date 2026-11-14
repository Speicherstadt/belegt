import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { darfSchreiben, type Rolle } from "../shared/rollen.ts";
import type { Angemeldet, Auth } from "./auth.ts";
import { eingerichtet } from "./db/status.ts";
import { aufnehmen, dateienPruefen, laden, listen, pruefen, type Umgebung, verlauf } from "./dokumente/dokumente.ts";
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
import { z3Export } from "./export/z3.ts";
import {
  beantragen,
  bestaetigen,
  fuerDokument,
  listen as loeschungenListen,
  zurueckziehen as loeschungZurueckziehen,
  regelVerletzt,
} from "./loeschung/loeschung.ts";
import {
  abrufen,
  type Oeffnen,
  QuelleEingabe,
  anlegen as quelleAnlegen,
  listen as quellenListen,
  aktivSetzen as quelleSchalten,
} from "./mail/abruf.ts";
import { importieren, mailZuDokument } from "./mail/import.ts";
import {
  aktivSetzen,
  RegelEingabe,
  anlegen as regelAnlegen,
  listen as regelnListen,
  vorschlag,
} from "./mail/regeln.ts";
import { einladen, offen as einladungOffen, listen as zugaengeListen, zurueckziehen } from "./zugang/einladungen.ts";
import { dokumentImPfad, imZeitraum, prueferDarf, prueferZeitraum, schnitt } from "./zugang/pruefer.ts";

/** Typen, die der Browser gefahrlos anzeigen kann; kein SVG und kein HTML, die Skripte enthalten könnten */
const ANSICHT = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Größte Datei je Upload */
export const MAX_UPLOAD = 100 * 1024 * 1024;

const Id = z.uuid();

/** Heutiger Tag in Deutschland, für Fristen (JJJJ-MM-TT) */
const Zeitraum = z.object({ von: z.iso.date(), bis: z.iso.date() });
const ZugangEingabe = z.discriminatedUnion("rolle", [
  z.object({ rolle: z.literal("steuerberatung") }),
  z.object({ rolle: z.literal("pruefer"), zeitraum: Zeitraum }),
]);

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
export function createApp(umgebung?: Umgebung & { auth: Auth; schluessel?: Buffer; oeffnen?: Oeffnen }) {
  const app = new Hono<{ Variables: { nutzer: Angemeldet } }>();

  /** Für Container und Überwachung: antwortet, sobald der Server läuft */
  app.get("/healthz", (c) => c.json({ ok: true }));

  if (umgebung) {
    const { auth } = umgebung;
    const eigeneHerkunft = new URL(auth.options.baseURL as string).origin;
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

    /** Öffentlich: ob es schon einen Inhaber gibt (Anmelden oder Einrichten) */
    app.get("/api/status", async (c) => c.json({ eingerichtet: await eingerichtet(umgebung.db) }));

    /** Öffentlich: ob ein Einladungslink noch gilt und für welche Rolle (Seite /einladung/…) */
    app.get("/api/einladung/:token", async (c) => {
      const e = await einladungOffen(umgebung.db, c.req.param("token"));
      return e ? c.json(e) : c.json({ fehler: "Die Einladung ist ungültig, abgelaufen oder schon eingelöst." }, 404);
    });

    app.use("/api/*", async (c, next) => {
      if (
        c.req.path.startsWith("/api/auth/") ||
        c.req.path === "/api/status" ||
        c.req.path.startsWith("/api/einladung/")
      )
        return next();
      const sitzung = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!sitzung) return c.json({ fehler: "Nicht angemeldet" }, 401);
      const u = sitzung.user as { role?: Rolle; zeitraumVon?: unknown; zeitraumBis?: unknown };
      const role = u.role ?? "pruefer";
      const nutzer: Angemeldet = {
        id: sitzung.user.id,
        email: sitzung.user.email,
        role,
        ...(role === "pruefer" ? { zeitraum: prueferZeitraum(u.zeitraumVon, u.zeitraumBis) } : {}),
      };
      const schreibt = c.req.method !== "GET" && c.req.method !== "HEAD";
      // Einzige Ausnahme: Die Steuerberatung bestätigt als zweite Person eine Löschung, die der Inhaber beantragt hat
      const zweitePerson =
        nutzer.role === "steuerberatung" &&
        c.req.method === "POST" &&
        /^\/api\/loeschungen\/[^/]+\/bestaetigen$/.test(c.req.path);
      if (schreibt && !darfSchreiben(nutzer.role) && !zweitePerson)
        return c.json({ fehler: "Diese Rolle darf nur lesen" }, 403);
      if (schreibt && vonFremderSeite(c.req.raw.headers, eigeneHerkunft)) {
        return c.json({ fehler: "Anfrage von einer fremden Seite" }, 403);
      }
      if (nutzer.zeitraum) {
        if (!prueferDarf(c.req.method, c.req.path)) return c.json({ fehler: "Nicht für den Prüferzugang" }, 403);
        // Ein Dokument außerhalb des Zeitraums gibt es für den Prüfer nicht
        const id = dokumentImPfad(c.req.path);
        if (id && !(await imZeitraum(umgebung.db, [id], nutzer.zeitraum)).has(id))
          return c.json({ fehler: "Nicht gefunden" }, 404);
      }
      c.set("nutzer", nutzer);
      return next();
    });

    app.get("/api/ich", (c) => c.json(c.get("nutzer")));

    // Zugänge verwaltet nur der Inhaber; die Liste zeigt keine Tokens
    app.get("/api/zugaenge", async (c) => {
      if (c.get("nutzer").role !== "inhaber") return c.json({ fehler: "Nur für den Inhaber" }, 403);
      return c.json(await zugaengeListen(umgebung.db));
    });

    app.post("/api/einladungen", async (c) => {
      const zugang = ZugangEingabe.safeParse(await c.req.json().catch(() => null));
      if (!zugang.success || (zugang.data.rolle === "pruefer" && zugang.data.zeitraum.von > zugang.data.zeitraum.bis))
        return c.json({ fehler: "Rolle steuerberatung, oder pruefer mit zeitraum (von, bis)" }, 400);
      const { einladung, token } = await einladen(umgebung.db, zugang.data, akteur(c.get("nutzer")));
      // Das Token steht nur in dieser Antwort; gespeichert ist nur sein Hash
      return c.json({ ...einladung, pfad: `/einladung/${token}` }, 201);
    });

    app.post("/api/einladungen/:id/zurueckziehen", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const ok = id.success && (await zurueckziehen(umgebung.db, id.data, akteur(c.get("nutzer"))));
      return ok ? c.json({ ok: true }) : c.json({ fehler: "Keine offene Einladung mit dieser ID" }, 404);
    });

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
      const limit = Math.min(Math.max(Math.trunc(Number(c.req.query("limit") ?? 50)) || 50, 1), 200);
      const gruppe = Gruppe.catch("alle").parse(c.req.query("gruppe") ?? "alle");
      return c.json(
        await listen(umgebung.db, {
          suche: c.req.query("suche"),
          limit,
          gruppe,
          heute: heute(),
          zeitraum: c.get("nutzer").zeitraum,
        }),
      );
    });

    app.get("/api/dokumente/:id", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
      return c.json({
        ...dokument,
        einordnung: await aktuelle(umgebung.db, dokument.id),
        loeschung: await fuerDokument(umgebung.db, dokument.id),
      });
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
        // Ein Trigger lehnt ab (etwa: schon gelöscht); seine Meldung ist für Menschen geschrieben
        const meldung = regelVerletzt(err);
        if (meldung) return c.json({ fehler: meldung }, 409);
        // fristende lehnt etwa einen Tag ab, den es nicht gibt, oder freiwillig ohne Datum; Datenbankfehler (mit cause
        // oder code) gehen nie mit ihrem Text an den Aufrufer, sie könnten SQL enthalten
        if (err instanceof Error && !("code" in err) && !("cause" in err && err.cause))
          return c.json({ fehler: err.message }, 400);
        throw err;
      }
    });

    app.post("/api/dokumente/:id/loeschung", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
      if (await fuerDokument(umgebung.db, dokument.id))
        return c.json({ fehler: "Für dieses Dokument gibt es schon eine Löschung" }, 409);
      try {
        return c.json(await beantragen(umgebung.db, umgebung.speicher, dokument.id, akteur(c.get("nutzer"))), 201);
      } catch (err) {
        const meldung = regelVerletzt(err);
        if (meldung) return c.json({ fehler: meldung }, 409);
        throw err;
      }
    });

    app.get("/api/loeschungen", async (c) => c.json(await loeschungenListen(umgebung.db)));

    app.post("/api/loeschungen/:id/bestaetigen", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
      try {
        const l = await bestaetigen(umgebung.db, umgebung.speicher, id.data, akteur(c.get("nutzer")));
        return l ? c.json(l) : c.json({ fehler: "Kein offener Antrag mit dieser ID" }, 404);
      } catch (err) {
        const meldung = regelVerletzt(err);
        if (meldung) return c.json({ fehler: meldung }, 409);
        throw err;
      }
    });

    app.delete("/api/loeschungen/:id", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const ok = id.success && (await loeschungZurueckziehen(umgebung.db, id.data, akteur(c.get("nutzer"))));
      return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein offener Antrag mit dieser ID" }, 404);
    });

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
      return c.json({
        ...mail,
        unterhaltung: mail.unterhaltung.filter((u) => sichtbar.has(u.dokumentId)),
        anhaenge: mail.anhaenge.filter((a) => sichtbar.has(a.dokumentId)),
        ausMail: mail.ausMail && sichtbar.has(mail.ausMail) ? mail.ausMail : null,
      });
    });

    app.get("/api/dokumente/:id/vorschlag", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      return c.json({ vorschlag: id.success ? await vorschlag(umgebung.db, id.data) : null });
    });

    app.get("/api/regeln", async (c) => c.json(await regelnListen(umgebung.db)));

    app.post("/api/regeln", async (c) => {
      const eingabe = RegelEingabe.safeParse(await c.req.json().catch(() => null));
      if (!eingabe.success) return c.json({ fehler: "Ungültige Regel", details: eingabe.error.issues }, 400);
      return c.json(await regelAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer"))), 201);
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
      return c.json(await abrufen(umgebung, umgebung.schluessel, id.data, umgebung.oeffnen));
    });

    app.post("/api/quellen/:id/:schalter{aktivieren|deaktivieren}", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const q = id.success
        ? await quelleSchalten(umgebung.db, id.data, c.req.param("schalter") === "aktivieren", akteur(c.get("nutzer")))
        : null;
      return q ? c.json(q) : c.json({ fehler: "Nicht gefunden" }, 404);
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
      if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
        return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
      const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
      // Fehlt die Datei oder passt ihr Hash nicht mehr, wird nichts ausgeliefert, was als Original gelten könnte
      if (!bytes) return c.json({ fehler: "Die Datei fehlt oder wurde verändert" }, 409);
      return c.body(new Uint8Array(bytes), 200, {
        "Content-Type": dokument.mimeType,
        // ?ansicht=1 zeigt PDFs und Bilder im Browser an, alles andere wird immer heruntergeladen
        "Content-Disposition": `${c.req.query("ansicht") === "1" && ANSICHT.has(dokument.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${dateinameKodiert(dokument.dateiname ?? dokument.sha256)}`,
        "X-Content-Type-Options": "nosniff",
      });
    });

    app.get("/api/dokumente/:id/verlauf", async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const dokument = id.success ? await laden(umgebung.db, id.data) : null;
      return dokument ? c.json(await verlauf(umgebung.db, dokument.id)) : c.json({ fehler: "Nicht gefunden" }, 404);
    });

    app.get("/api/export", async (c) => {
      const zeitraum = Zeitraum.safeParse({ von: c.req.query("von"), bis: c.req.query("bis") });
      if (!zeitraum.success || zeitraum.data.von > zeitraum.data.bis)
        return c.json({ fehler: "Zeitraum mit von und bis (JJJJ-MM-TT) angeben" }, 400);
      // Der Prüfer bekommt nur den Teil, der in seinem Zeitraum liegt
      const freigabe = c.get("nutzer").zeitraum;
      const teil = freigabe ? schnitt(zeitraum.data, freigabe) : zeitraum.data;
      if (!teil) return c.json({ fehler: "Der Zeitraum liegt außerhalb der Freigabe" }, 403);
      const stream = await z3Export(umgebung, teil);
      return c.body(stream, 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="belegt-z3-${teil.von}-${teil.bis}.zip"`,
        "X-Content-Type-Options": "nosniff",
      });
    });

    app.get("/api/pruefung", async (c) => {
      const befunde = await pruefen(umgebung.db);
      // ?dateien=1 liest zusätzlich jede Datei und vergleicht sie mit ihrem Hash
      if (c.req.query("dateien") === "1") {
        const dateien = await dateienPruefen(umgebung);
        const alle = [...befunde, ...dateien.befunde];
        return c.json({ ok: alle.length === 0, befunde: alle, dateienGeprueft: dateien.geprueft });
      }
      return c.json({ ok: befunde.length === 0, befunde });
    });
  }

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
