import { darfSchreiben, type Rolle } from "../../shared/rollen.ts";
import type { Angemeldet } from "../auth.ts";
import { einladen, listen as zugaengeListen, zurueckziehen } from "../zugang/einladungen.ts";
import { dokumentImPfad, imZeitraum, prueferDarf, prueferZeitraum } from "../zugang/pruefer.ts";
import {
  finden,
  TokenEingabe,
  anlegen as tokenAnlegen,
  tokenDarf,
  listen as tokensListen,
  widerrufen,
} from "../zugang/tokens.ts";

import { type App, type AppUmgebung, akteur, Id, vonFremderSeite, ZugangEingabe } from "./gemeinsam.ts";

export function zugangRouten(app: App, umgebung: AppUmgebung) {
  const { auth } = umgebung;
  const eigeneHerkunft = new URL(auth.options.baseURL as string).origin;

  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth/") ||
      c.req.path === "/api/status" ||
      c.req.path === "/api/openapi.json" ||
      c.req.path.startsWith("/api/einladung/") ||
      // Der Link selbst ist die Berechtigung („Öffnen mit …“, server/freigabe/freigabe.ts)
      c.req.path.startsWith("/api/freigabe/")
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
    // Eine Kopie für „Öffnen mit …“ ist Lesen, auch wenn der Link per POST entsteht
    const kopie =
      nutzer.role === "steuerberatung" &&
      c.req.method === "POST" &&
      /^\/api\/dokumente\/[^/]+\/freigabe$/.test(c.req.path);
    if (schreibt && !darfSchreiben(nutzer.role) && !zweitePerson && !kopie)
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
