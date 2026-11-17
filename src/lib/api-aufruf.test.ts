import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFehler, aufruf } from "./api-aufruf.ts";

const antworten = (body: string, status: number, statusText = "") =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, statusText })),
  );

const meldung = async () => {
  const fehler = await aufruf("/api/x").catch((e: unknown) => e);
  expect(fehler).toBeInstanceOf(ApiFehler);
  return (fehler as ApiFehler).message;
};

afterEach(() => vi.unstubAllGlobals());

describe("Fehlermeldung einer Antwort", () => {
  it("zeigt bei HTML (Proxy) nur Status und Statustext", async () => {
    antworten("<html><body>Bad Gateway</body></html>", 502, "Bad Gateway");
    expect(await meldung()).toBe("502 Bad Gateway");
  });
  it("zeigt bei HTML ohne Statustext nur den Status", async () => {
    antworten("<!doctype html><title>x</title>", 502);
    expect(await meldung()).toBe("502");
  });
  it("nimmt bei JSON das Feld fehler", async () => {
    antworten('{"fehler":"Zugang entzogen"}', 401);
    expect(await meldung()).toBe("Zugang entzogen");
  });
  it("nimmt bei JSON ohne fehler und message den Rohtext", async () => {
    antworten('{"anderes":1}', 500);
    expect(await meldung()).toBe('{"anderes":1}');
  });
  it("nimmt bei Klartext den Klartext", async () => {
    antworten("404 page not found", 404);
    expect(await meldung()).toBe("404 page not found");
  });
});
