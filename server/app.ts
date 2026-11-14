import { Hono } from "hono";

/** Die HTTP-Schnittstelle; ohne Bun.serve, damit Tests sie direkt mit app.request aufrufen. */
export function createApp() {
  const app = new Hono();

  /** Für Container und Überwachung: antwortet, sobald der Server läuft */
  app.get("/healthz", (c) => c.json({ ok: true }));

  app.notFound((c) => c.json({ fehler: "Nicht gefunden" }, 404));

  return app;
}
