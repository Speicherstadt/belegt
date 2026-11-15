import { z } from "zod";
import { laden } from "../dokumente/dokumente.ts";
import { abrufFesthalten, einloesenGeteilt, geteilteListen, TAGE, teilen, widerrufen } from "../freigabe/teilen.ts";
import { fuerDokument } from "../loeschung/loeschung.ts";
import { type App, type AppUmgebung, akteur, dateinameKodiert, Id } from "./gemeinsam.ts";

const Eingabe = z.object({ tage: z.union(TAGE.map((t) => z.literal(t))) });

/** Antwort für Menschen, die den Link im Browser öffnen */
const text = (meldung: string, status: 404 | 409 | 410) =>
  new Response(meldung, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

/**
 * Teilen per Link: anlegen, auflisten und widerrufen nur der Inhaber mit seiner Sitzung; die Datei über den Link holt
 * jeder, der ihn hat, ohne Anmeldung, und jeder Abruf wird festgehalten.
 */
export function teilenRouten(app: App, umgebung: AppUmgebung) {
  const basis = String(umgebung.auth.options.baseURL).replace(/\/$/, "");
  // Nur der Inhaber gibt ein Original an Dritte; die Steuerberatung und Prüfer lesen nur, ein API-Token teilt nicht
  const inhaber = (n: { role: string; token?: unknown }) => n.role === "inhaber" && !n.token;

  app.post("/api/dokumente/:id/links", async (c) => {
    if (!inhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const eingabe = Eingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "tage: 1, 7 oder 30" }, 400);
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
    const link = await teilen(umgebung.db, dokument.id, akteur(c.get("nutzer")), eingabe.data.tage);
    // Den Link gibt es nur in dieser Antwort; gespeichert ist nur sein Hash
    return c.json({ id: link.id, url: `${basis}/api/geteilt/${link.token}`, gueltigBis: link.gueltigBis }, 201);
  });

  app.get("/api/dokumente/:id/links", async (c) => {
    if (!inhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json(await geteilteListen(umgebung.db, id.data));
  });

  app.post("/api/dokumente/:id/links/:link/widerrufen", async (c) => {
    if (!inhaber(c.get("nutzer"))) return c.json({ fehler: "Nur für den Inhaber" }, 403);
    const id = Id.safeParse(c.req.param("id"));
    const link = Id.safeParse(c.req.param("link"));
    const ok =
      id.success && link.success && (await widerrufen(umgebung.db, id.data, link.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Kein gültiger Link mit dieser ID" }, 404);
  });

  app.get("/api/geteilt/:token", async (c) => {
    const link = await einloesenGeteilt(umgebung.db, c.req.param("token"));
    const dokument = link ? await laden(umgebung.db, link.dokumentId) : null;
    if (!link || !dokument) return text("Der Link ist ungültig, abgelaufen oder widerrufen.", 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return text("Das Dokument ist nach Ablauf seiner Frist gelöscht.", 410);
    const kopf = {
      "Content-Type": dokument.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${dateinameKodiert(dokument.dateiname ?? dokument.sha256)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    };
    // Eine Vorschau im Messenger fragt oft nur nach dem Kopf: kein Abruf, keine Datei
    if (c.req.method === "HEAD") return c.body(null, 200, kopf);
    const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
    if (!bytes) return text("Die Datei fehlt oder wurde verändert.", 409);
    if (!(await abrufFesthalten(umgebung.db, link.freigabeId)))
      return text("Der Link ist ungültig, abgelaufen oder widerrufen.", 404);
    return c.body(new Uint8Array(bytes), 200, kopf);
  });
}
