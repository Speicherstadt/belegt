import { darfSchreiben, type Rolle } from "../../shared/rollen.ts";
import type { Angemeldet } from "../auth.ts";
import {
  einladen,
  entziehen,
  mitarbeiterAendern,
  listen as zugaengeListen,
  zugangLaden,
  zurueckziehen,
} from "../zugang/einladungen.ts";
import { mitarbeiterDarf } from "../zugang/mitarbeiter.ts";
import { dokumentImPfad, prueferDarf, prueferZeitraum } from "../zugang/pruefer.ts";
import { sichtbareIds, sichtVon } from "../zugang/sicht.ts";
import {
  finden,
  TokenEingabe,
  anlegen as tokenAnlegen,
  tokenDarf,
  listen as tokensListen,
  widerrufen,
} from "../zugang/tokens.ts";

import {
  type App,
  type AppUmgebung,
  akteur,
  Id,
  MitarbeiterEingabe,
  SichtbereichEingabe,
  vonFremderSeite,
  ZugangEingabe,
} from "./gemeinsam.ts";

/** Der Inhaber mit seiner Sitzung, kein Programm mit Token */
const nurInhaber = (n: Angemeldet) => n.role === "inhaber" && !n.token;

export function zugangRouten(app: App, umgebung: AppUmgebung) {
  const { auth } = umgebung;
  const eigeneHerkunft = new URL(auth.options.baseURL as string).origin;

  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth/") ||
      c.req.path === "/api/status" ||
      c.req.path === "/api/openapi.json" ||
      c.req.path.startsWith("/api/einladung/") ||
      // Der Link selbst ist die Berechtigung („Öffnen mit …“ und Teilen per Link, server/freigabe/)
      c.req.path.startsWith("/api/freigabe/") ||
      c.req.path.startsWith("/api/geteilt/")
    )
      return next();
    // Programme melden sich mit einem API-Token an, nicht mit dem Cookie; deshalb gilt für sie keine CSRF-Prüfung
    const kopf = c.req.header("authorization");
    if (kopf?.startsWith("Bearer ")) {
      const token = await finden(umgebung.db, kopf.slice(7).trim());
      if (!token) return c.json({ fehler: "Token ungültig oder widerrufen" }, 401);
      if (!tokenDarf(token.recht, c.req.method, c.req.path))
        return c.json({ fehler: "Für dieses Token nicht erlaubt" }, 403);
      c.set("nutzer", {
        id: token.id,
        email: "",
        role: token.recht === "schreiben" ? "inhaber" : "steuerberatung",
        token: { name: token.name, recht: token.recht },
      });
      return next();
    }
    const sitzung = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!sitzung) return c.json({ fehler: "Nicht angemeldet" }, 401);
    const u = sitzung.user as { role?: Rolle; zeitraumVon?: unknown; zeitraumBis?: unknown };
    const role = u.role ?? "pruefer";
    // Recht, Sichtbereich und Entzug gelten sofort, deshalb frisch aus der Datenbank und nicht aus der Sitzung
    const frisch = role === "inhaber" ? null : await zugangLaden(umgebung.db, sitzung.user.id);
    if (role !== "inhaber" && (!frisch || frisch.entzogenAm)) return c.json({ fehler: "Zugang entzogen" }, 401);
    const bereich = role === "mitarbeiter" ? SichtbereichEingabe.safeParse(frisch?.sichtbereich) : null;
    if (bereich && (!bereich.success || !frisch?.recht))
      return c.json({ fehler: "Sichtbereich ungültig; bitte den Inhaber fragen" }, 403);
    const nutzer: Angemeldet = {
      id: sitzung.user.id,
      email: sitzung.user.email,
      role,
      ...(role === "pruefer" ? { zeitraum: prueferZeitraum(u.zeitraumVon, u.zeitraumBis) } : {}),
      ...(bereich?.success && frisch?.recht ? { sichtbereich: bereich.data, recht: frisch.recht } : {}),
    };
    const schreibt = c.req.method !== "GET" && c.req.method !== "HEAD";
    // Einzige Ausnahme: Die Steuerberatung bestätigt als zweite Person eine Löschung, die der Inhaber beantragt hat
    const zweitePerson =
      nutzer.role === "steuerberatung" &&
      c.req.method === "POST" &&
      /^\/api\/loeschungen\/[^/]+\/bestaetigen$/.test(c.req.path);
    // Eine Kopie für „Öffnen mit …“ ist Lesen, auch wenn der Link per POST entsteht
    const kopie =
      nutzer.role === "steuerberatung" &&
      c.req.method === "POST" &&
      /^\/api\/dokumente\/[^/]+\/freigabe$/.test(c.req.path);
    // Notizen schreibt und zieht auch die Steuerberatung zurück: Anmerkungen zum Beleg, keine Änderung an ihm
    const notiz =
      nutzer.role === "steuerberatung" &&
      c.req.method === "POST" &&
      /^\/api\/dokumente\/[^/]+\/notizen(\/[^/]+\/zurueckziehen)?$/.test(c.req.path);
    // Eigene gespeicherte Ansichten und Kacheln der Startseite legt jede Rolle an: Einstellungen, keine Änderung an
    // Dokumenten
    const ansicht = /^\/api\/(ansichten(\/[^/]+)?|start\/kacheln)$/.test(c.req.path);
    // Der Mitarbeiter hat eine eigene Liste erlaubter Aufrufe, die auch das Schreiben regelt
    if (nutzer.role === "mitarbeiter") {
      if (!nutzer.recht || !mitarbeiterDarf(nutzer.recht, c.req.method, c.req.path))
        return c.json({ fehler: "Nicht für diesen Zugang" }, 403);
    } else if (schreibt && !darfSchreiben(nutzer.role) && !zweitePerson && !kopie && !notiz && !ansicht)
      return c.json({ fehler: "Diese Rolle darf nur lesen" }, 403);
    if (schreibt && vonFremderSeite(c.req.raw.headers, eigeneHerkunft)) {
      return c.json({ fehler: "Anfrage von einer fremden Seite" }, 403);
    }
    if (nutzer.zeitraum && !prueferDarf(c.req.method, c.req.path))
      return c.json({ fehler: "Nicht für den Prüferzugang" }, 403);
    // Ein Dokument außerhalb von Zeitraum oder Sichtbereich gibt es für diesen Zugang nicht (server/zugang/sicht.ts)
    const sicht = sichtVon(nutzer);
    const id = dokumentImPfad(c.req.path);
    if (sicht && id && !(await sichtbareIds(umgebung.db, [id], sicht)).has(id))
      return c.json({ fehler: "Nicht gefunden" }, 404);
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
      return c.json(
        { fehler: "Rolle steuerberatung, pruefer mit zeitraum (von, bis) oder mitarbeiter mit recht und sichtbereich" },
        400,
      );
    const { einladung, token } = await einladen(umgebung.db, zugang.data, akteur(c.get("nutzer")));
    // Das Token steht nur in dieser Antwort; gespeichert ist nur sein Hash
    return c.json({ ...einladung, pfad: `/einladung/${token}` }, 201);
  });

  app.post("/api/einladungen/:id/zurueckziehen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await zurueckziehen(umgebung.db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Keine offene Einladung mit dieser ID" }, 404);
  });

  /** Recht und Sichtbereich eines Mitarbeiters ändern (im Audit-Log) */
  app.patch("/api/zugaenge/:id", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const eingabe = MitarbeiterEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "recht (lesen oder bearbeiten) und sichtbereich angeben" }, 400);
    const ok = await mitarbeiterAendern(umgebung.db, c.req.param("id"), eingabe.data, akteur(c.get("nutzer")));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein Mitarbeiter mit dieser ID" }, 404);
  });

  /** Einen Zugang entziehen, nie den des Inhabers */
  app.post("/api/zugaenge/:id/entziehen", async (c) => {
    if (!nurInhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const ok = await entziehen(umgebung.db, c.req.param("id"), akteur(c.get("nutzer")));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein Zugang mit dieser ID, der sich entziehen lässt" }, 404);
  });

  // API-Tokens verwaltet nur der Inhaber mit seiner Sitzung; ein Token erreicht diese Aufrufe nicht (tokenDarf)
  app.get("/api/tokens", async (c) => {
    if (c.get("nutzer").role !== "inhaber") return c.json({ fehler: "Nur für den Inhaber" }, 403);
    return c.json(await tokensListen(umgebung.db));
  });

  app.post("/api/tokens", async (c) => {
    const eingabe = TokenEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "name und recht (lesen oder schreiben) angeben" }, 400);
    const { token, klartext } = await tokenAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer")));
    // Den Klartext gibt es nur in dieser Antwort; gespeichert ist nur sein Hash
    return c.json({ ...token, klartext }, 201);
  });

  app.post("/api/tokens/:id/widerrufen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await widerrufen(umgebung.db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein gültiges Token mit dieser ID" }, 404);
  });
}
