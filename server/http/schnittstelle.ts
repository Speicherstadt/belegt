import { bodyLimit } from "hono/body-limit";
import { beantworten } from "../mcp/protokoll.ts";
import { aktivSetzen, anlegen, listen, WebhookEingabe } from "../webhooks/webhooks.ts";
import { type App, type AppUmgebung, akteur, Id, MAX_UPLOAD } from "./gemeinsam.ts";

/** Webhooks verwaltet nur der Inhaber; das Geheimnis gibt es einmal beim Anlegen */
export function schnittstelleRouten(app: App, umgebung: AppUmgebung) {
  // MCP für KI-Assistenten, zustandslos: kein Datenstrom per GET, keine Sitzung zum Beenden
  app.get("/api/mcp", (c) => c.body(null, 405, { Allow: "POST" }));
  app.delete("/api/mcp", (c) => c.body(null, 405, { Allow: "POST" }));

  app.post(
    "/api/mcp",
    // Base64 macht Dateien um ein Drittel größer
    bodyLimit({
      maxSize: Math.ceil((MAX_UPLOAD * 4) / 3) + 1024 * 1024,
      onError: (c) => c.json({ fehler: "Zu groß" }, 413),
    }),
    async (c) => {
      const nachricht = await c.req.json().catch(() => undefined);
      if (nachricht === undefined)
        return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Kein gültiges JSON" } }, 400);
      const antwort = await beantworten(umgebung, c.get("nutzer"), nachricht);
      return antwort ? c.json(antwort) : c.body(null, 202);
    },
  );

  app.get("/api/webhooks", async (c) => {
    if (c.get("nutzer").role !== "inhaber" || c.get("nutzer").token)
      return c.json({ fehler: "Nur für den Inhaber" }, 403);
    return c.json(await listen(umgebung.db));
  });

  app.post("/api/webhooks", async (c) => {
    if (!umgebung.schluessel) return c.json({ fehler: "BELEGT_SCHLUESSEL fehlt auf dem Server" }, 503);
    const eingabe = WebhookEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "name, url (http oder https) und arten angeben" }, 400);
    const { webhook, geheimnis } = await anlegen(
      umgebung.db,
      umgebung.schluessel,
      eingabe.data,
      akteur(c.get("nutzer")),
    );
    return c.json({ ...webhook, geheimnis }, 201);
  });

  for (const [pfad, aktiv] of [
    ["aktivieren", true],
    ["deaktivieren", false],
  ] as const) {
    app.post(`/api/webhooks/:id/${pfad}`, async (c) => {
      const id = Id.safeParse(c.req.param("id"));
      const w = id.success ? await aktivSetzen(umgebung.db, id.data, aktiv, akteur(c.get("nutzer"))) : null;
      return w ? c.json(w) : c.json({ fehler: "Nicht gefunden" }, 404);
    });
  }
}
