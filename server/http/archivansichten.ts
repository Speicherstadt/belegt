import {
  AnsichtAenderung,
  AnsichtEingabe,
  ansichtAendern,
  ansichtAnlegen,
  ansichtenListen,
  ansichtLoeschen,
  nameVergeben,
  Reihenfolge,
  reihenfolgeSetzen,
} from "../archivansichten/archivansichten.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/*
 * Gespeicherte Ansichten des Archivs, je Zugang (server/archivansichten/). Anlegen, ändern und löschen dürfen alle
 * Rollen ihre eigenen (Ausnahme in server/http/zugang.ts); „für alle“ nur der Inhaber.
 */
export function archivansichtenRouten(app: App, umgebung: AppUmgebung) {
  const NAME_VERGEBEN = { fehler: "Eine Ansicht mit diesem Namen gibt es schon" };

  app.get("/api/ansichten", async (c) => c.json(await ansichtenListen(umgebung.db, c.get("nutzer"))));

  app.post("/api/ansichten", async (c) => {
    const nutzer = c.get("nutzer");
    const eingabe = AnsichtEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "name (1 bis 100 Zeichen) und parameter angeben" }, 400);
    if (eingabe.data.fuerAlle && nutzer.role !== "inhaber")
      return c.json({ fehler: "Für alle freigeben darf nur der Inhaber" }, 403);
    try {
      return c.json(await ansichtAnlegen(umgebung.db, nutzer, eingabe.data, akteur(nutzer)), 201);
    } catch (err) {
      if (nameVergeben(err)) return c.json(NAME_VERGEBEN, 409);
      throw err;
    }
  });

  // Vor /:id, sonst nähme Hono „reihenfolge“ als ID
  app.post("/api/ansichten/reihenfolge", async (c) => {
    const nutzer = c.get("nutzer");
    const eingabe = Reihenfolge.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "ids angeben" }, 400);
    const ok = await reihenfolgeSetzen(umgebung.db, nutzer, eingabe.data.ids, akteur(nutzer));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Nur eigene Ansichten lassen sich ordnen" }, 404);
  });

  app.patch("/api/ansichten/:id", async (c) => {
    const nutzer = c.get("nutzer");
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    const eingabe = AnsichtAenderung.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültige Änderung" }, 400);
    if (eingabe.data.fuerAlle && nutzer.role !== "inhaber")
      return c.json({ fehler: "Für alle freigeben darf nur der Inhaber" }, 403);
    try {
      const a = await ansichtAendern(umgebung.db, nutzer, id.data, eingabe.data, akteur(nutzer));
      return a ? c.json(a) : c.json({ fehler: "Nicht gefunden" }, 404);
    } catch (err) {
      if (nameVergeben(err)) return c.json(NAME_VERGEBEN, 409);
      throw err;
    }
  });

  app.delete("/api/ansichten/:id", async (c) => {
    const nutzer = c.get("nutzer");
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await ansichtLoeschen(umgebung.db, nutzer, id.data, akteur(nutzer)));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
