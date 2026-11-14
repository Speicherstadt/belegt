import { laden } from "../dokumente/dokumente.ts";
import { einloesen, freigeben, zielAdresse } from "../freigabe/freigabe.ts";
import { fuerDokument } from "../loeschung/loeschung.ts";
import { type App, type AppUmgebung, akteur, dateinameKodiert, Id } from "./gemeinsam.ts";

/** „Öffnen mit …“: Link anlegen (angemeldet) und die Datei über den Link holen (ohne Anmeldung, nur mit dem Link) */
export function freigabeRouten(app: App, umgebung: AppUmgebung) {
  const { oeffnenMit } = umgebung;
  const basis = String(umgebung.auth.options.baseURL).replace(/\/$/, "");

  app.post("/api/dokumente/:id/freigabe", async (c) => {
    if (!oeffnenMit) return c.json({ fehler: "„Öffnen mit …“ ist nicht eingerichtet" }, 404);
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
    const { token, gueltigBis } = await freigeben(umgebung.db, dokument.id, akteur(c.get("nutzer")));
    const url = zielAdresse(oeffnenMit.url, {
      url: `${basis}/api/freigabe/${token}`,
      name: dokument.dateiname ?? dokument.sha256,
    });
    return c.json({ url, gueltigBis }, 201);
  });

  app.get("/api/freigabe/:token", async (c) => {
    const dokumentId = await einloesen(umgebung.db, c.req.param("token"));
    const dokument = dokumentId ? await laden(umgebung.db, dokumentId) : null;
    if (!dokument) return c.json({ fehler: "Der Link ist ungültig oder abgelaufen" }, 404);
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return c.json({ fehler: "Das Dokument ist gelöscht" }, 410);
    const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
    if (!bytes) return c.json({ fehler: "Die Datei fehlt oder wurde verändert" }, 409);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": dokument.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${dateinameKodiert(dokument.dateiname ?? dokument.sha256)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      // Eine App im Browser holt die Datei selbst; nur ihr Origin darf die Antwort lesen
      ...(oeffnenMit ? { "Access-Control-Allow-Origin": new URL(oeffnenMit.url).origin, Vary: "Origin" } : {}),
    });
  });
}
