import type { Context } from "hono";
import type { z } from "zod";
import {
  KorrespondentAenderung,
  KorrespondentEingabe,
  korrespondentAendern,
  korrespondentAnlegen,
  korrespondentenListen,
  korrespondentLoeschen,
  Zusammenfuehrung,
  zusammenfuehren,
} from "../ordnung/korrespondenten.ts";
import {
  DokumenttypAenderung,
  DokumenttypEingabe,
  dokumenttypAendern,
  dokumenttypAnlegen,
  dokumenttypenListen,
  dokumenttypLoeschen,
  FeldAenderung,
  FeldEingabe,
  feldAendern,
  feldAnlegen,
  felderListen,
  feldLoeschen,
  istKonflikt,
  TagAenderung,
  TagEingabe,
  tagAendern,
  tagAnlegen,
  tagLoeschen,
  tagsListen,
} from "../ordnung/ordnung.ts";
import { Aenderung, gibtEs, ordnungZu, Sammlung, sammeln } from "../ordnung/zuordnung.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

type Ctx = Context<{ Variables: { nutzer: import("../auth.ts").Angemeldet } }>;

/** Antwort auf einen Konflikt aus dem Modul (doppelter Name, unbekannter Tag, ungültiger Wert); alles andere wirft weiter */
function konfliktAntwort(c: Ctx, err: unknown) {
  if (!istKonflikt(err)) throw err;
  return c.json({ fehler: err.message }, "ungueltig" in err ? 400 : 409);
}

async function eingabe<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T> | null> {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  return r.success ? r.data : null;
}

/**
 * Anlegen, ändern und löschen für Tags, Dokumenttypen, Korrespondenten und Felder; alle gleich gebaut. Ändern ist PATCH,
 * löschen entfernt erst die Zuordnungen (jede im Audit-Log).
 */
function verwalten<E extends z.ZodType, A extends z.ZodType, T>(
  app: App,
  pfad: string,
  f: {
    /** zeitraum: der eines Prüfers, der nur Dokumente darin zählen sieht */
    listen: (zeitraum?: { von: string; bis: string }) => Promise<T[]>;
    Eingabe: E;
    Aenderung: A;
    anlegen: (e: z.infer<E>, akteur: string) => Promise<T>;
    aendern: (id: string, e: z.infer<A>, akteur: string) => Promise<T | null>;
    loeschen: (id: string, akteur: string) => Promise<boolean>;
  },
) {
  app.get(pfad, async (c) => c.json(await f.listen(c.get("nutzer").zeitraum)));
  app.post(pfad, async (c) => {
    const e = await eingabe(c, f.Eingabe);
    if (!e) return c.json({ fehler: "Ungültige Angaben" }, 400);
    return f.anlegen(e, akteur(c.get("nutzer"))).then(
      (neu) => c.json(neu, 201),
      (err) => konfliktAntwort(c, err),
    );
  });
  app.patch(`${pfad}/:id`, async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const e = await eingabe(c, f.Aenderung);
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    if (!e) return c.json({ fehler: "Ungültige Angaben" }, 400);
    return f.aendern(id.data, e, akteur(c.get("nutzer"))).then(
      (t) => (t ? c.json(t) : c.json({ fehler: "Nicht gefunden" }, 404)),
      (err) => konfliktAntwort(c, err),
    );
  });
  app.delete(`${pfad}/:id`, async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    return f.loeschen(id.data, akteur(c.get("nutzer"))).then(
      (ok) => (ok ? c.json({ ok: true }) : c.json({ fehler: "Nicht gefunden" }, 404)),
      (err) => konfliktAntwort(c, err),
    );
  });
}

export function ordnungRouten(app: App, { db }: AppUmgebung) {
  verwalten(app, "/api/tags", {
    listen: (zeitraum) => tagsListen(db, zeitraum),
    Eingabe: TagEingabe,
    Aenderung: TagAenderung,
    anlegen: (e, a) => tagAnlegen(db, e, a),
    aendern: (id, e, a) => tagAendern(db, id, e, a),
    loeschen: (id, a) => tagLoeschen(db, id, a),
  });
  verwalten(app, "/api/dokumenttypen", {
    listen: (zeitraum) => dokumenttypenListen(db, zeitraum),
    Eingabe: DokumenttypEingabe,
    Aenderung: DokumenttypAenderung,
    anlegen: (e, a) => dokumenttypAnlegen(db, e, a),
    aendern: (id, e, a) => dokumenttypAendern(db, id, e, a),
    loeschen: (id, a) => dokumenttypLoeschen(db, id, a),
  });
  verwalten(app, "/api/korrespondenten", {
    listen: (zeitraum) => korrespondentenListen(db, zeitraum),
    Eingabe: KorrespondentEingabe,
    Aenderung: KorrespondentAenderung,
    anlegen: (e, a) => korrespondentAnlegen(db, e, a),
    aendern: (id, e, a) => korrespondentAendern(db, id, e, a),
    loeschen: (id, a) => korrespondentLoeschen(db, id, a),
  });

  /** Zwei Schreibweisen zusammenführen: :id geht in ziel auf; Antwort: der verbleibende Korrespondent */
  app.post("/api/korrespondenten/:id/zusammenfuehren", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    const e = await eingabe(c, Zusammenfuehrung);
    if (!e) return c.json({ fehler: "ziel (ID des verbleibenden Korrespondenten) angeben" }, 400);
    return zusammenfuehren(db, id.data, e.ziel, akteur(c.get("nutzer"))).then(
      (k) => (k ? c.json(k) : c.json({ fehler: "Nicht gefunden" }, 404)),
      (err) => konfliktAntwort(c, err),
    );
  });
  verwalten(app, "/api/felder", {
    listen: () => felderListen(db),
    Eingabe: FeldEingabe,
    Aenderung: FeldAenderung,
    anlegen: (e, a) => feldAnlegen(db, e, a),
    aendern: (id, e, a) => feldAendern(db, id, e, a),
    loeschen: (id, a) => feldLoeschen(db, id, a),
  });

  /** Tags, Dokumenttyp und Feldwerte eines Dokuments ändern; Antwort: der neue Stand */
  app.post("/api/dokumente/:id/ordnung", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success || !(await gibtEs(db, id.data))) return c.json({ fehler: "Nicht gefunden" }, 404);
    const e = await eingabe(c, Aenderung);
    if (!e) return c.json({ fehler: "Ungültige Änderung" }, 400);
    try {
      const r = await sammeln(db, [id.data], e, akteur(c.get("nutzer")));
      if (!r.ok)
        return c.json({ fehler: r.ergebnisse[0]?.ok === false ? r.ergebnisse[0].fehler : "Nicht möglich" }, 409);
      return c.json(await ordnungZu(db, id.data));
    } catch (err) {
      return konfliktAntwort(c, err);
    }
  });

  /** Sammelbearbeitung: eine Änderung für viele Dokumente, alles oder nichts, Ergebnis je Dokument */
  app.post("/api/dokumente/sammeln", async (c) => {
    const e = await eingabe(c, Sammlung);
    if (!e) return c.json({ fehler: "Ungültige Sammelbearbeitung" }, 400);
    const { ids, ...aenderung } = e;
    try {
      const r = await sammeln(db, ids, aenderung, akteur(c.get("nutzer")));
      return c.json(r, r.ok ? 200 : 409);
    } catch (err) {
      return konfliktAntwort(c, err);
    }
  });
}
