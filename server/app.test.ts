import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

describe("createApp", () => {
  it("antwortet auf /healthz", async () => {
    const res = await createApp().request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("antwortet auf Unbekanntes mit 404 als JSON", async () => {
    const res = await createApp().request("/gibt-es-nicht");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ fehler: "Nicht gefunden" });
  });
});
