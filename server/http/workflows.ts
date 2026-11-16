import { nameVergeben } from "../archivansichten/archivansichten.ts";
import { laden } from "../dokumente/dokumente.ts";
import { istKonflikt } from "../ordnung/ordnung.ts";
import { weitergabenZu } from "../weitergabe/weitergabe.ts";
import {
  laeufeListen,
  Reihenfolge,
  WorkflowEingabe,
  workflowAnlegen,
  workflowLoeschen,
  workflowSchalten,
  workflowsListen,
  workflowsOrdnen,
} from "../workflows/workflows.ts";

import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/*
 * Workflows (server/workflows/): lesen Inhaber und Steuerberatung, ändern nur der Inhaber (die Rolle prüft
 * server/http/zugang.ts für alle schreibenden Aufrufe), der Prüfer und Programme mit Token gar nicht.
 */
export function workflowsRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/workflows", async (c) => c.json(await workflowsListen(umgebung.db)));

  app.get("/api/workflows/laeufe", async (c) =>
    c.json(await laeufeListen(umgebung.db, { limit: 50, alle: c.req.query("alle") === "1" })),
  );

  app.post("/api/workflows", async (c) => {
    const eingabe = WorkflowEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "Ungültiger Workflow", details: eingabe.error.issues }, 400);
    try {
      return c.json(
        await workflowAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer")), umgebung.schluessel),
        201,
      );
    } catch (err) {
      if (err instanceof Error && "ohneSchluessel" in err)
        return c.json({ fehler: "Ohne BELEGT_SCHLUESSEL lässt sich keine Kopfzeile speichern" }, 503);
      if (nameVergeben(err)) return c.json({ fehler: "Einen Workflow mit diesem Namen gibt es schon" }, 409);
      if (!istKonflikt(err)) throw err;
      return c.json({ fehler: err.message }, "ungueltig" in err ? 400 : 409);
    }
  });

  /** Was die Aktion „Original an Adresse senden“ mit einem Dokument getan hat (server/weitergabe/) */
  app.get("/api/dokumente/:id/weitergaben", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json(await weitergabenZu(umgebung.db, dokument.id));
  });

  app.post("/api/workflows/reihenfolge", async (c) => {
    const eingabe = Reihenfolge.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "ids angeben" }, 400);
    const ok = await workflowsOrdnen(umgebung.db, eingabe.data.ids, akteur(c.get("nutzer")));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Unbekannter Workflow" }, 404);
  });

  app.post("/api/workflows/:id/:schalter{aktivieren|deaktivieren}", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const aktiv = c.req.param("schalter") === "aktivieren";
    const w = id.success ? await workflowSchalten(umgebung.db, id.data, aktiv, akteur(c.get("nutzer"))) : null;
    return w ? c.json(w) : c.json({ fehler: "Nicht gefunden" }, 404);
  });

  app.delete("/api/workflows/:id", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await workflowLoeschen(umgebung.db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Nicht gefunden" }, 404);
  });
}
