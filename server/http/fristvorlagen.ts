import { nameVergeben } from "../archivansichten/archivansichten.ts";
import { VorlageEingabe, vorlageAnlegen, vorlageLoeschen, vorlagenListen } from "../fristvorlagen/fristvorlagen.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/** Eigene Fristvorlagen (server/fristvorlagen/): lesen alle, die einordnen; anlegen und löschen der Inhaber */
export function fristvorlagenRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/fristvorlagen", async (c) => c.json(await vorlagenListen(umgebung.db)));

  app.post("/api/fristvorlagen", async (c) => {
    const eingabe = VorlageEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "name (1 bis 100 Zeichen) und monate (1 bis 1200) angeben" }, 400);
    try {
      return c.json(await vorlageAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      if (nameVergeben(err)) return c.json({ fehler: "Eine Vorlage mit diesem Namen gibt es schon" }, 409);
      throw err;
    }
  });

  app.delete("/api/fristvorlagen/:id", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await vorlageLoeschen(umgebung.db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Keine Vorlage mit dieser ID" }, 404);
  });
}
