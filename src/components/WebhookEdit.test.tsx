import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type Webhook } from "../lib/api.ts";
import { WebhookEdit, WebhookEditForm, webhookAenderung } from "./WebhookEdit.tsx";

const webhook: Webhook = {
  id: "w1",
  name: "Buchhaltung",
  url: "https://buchhaltung.example/belegt",
  arten: ["dokument.aufgenommen"],
  aktiv: true,
  letzteZustellung: null,
  letzterFehler: null,
};

const formular = (name: string, url: string, arten: string[]) => {
  const f = new FormData();
  f.set("name", name);
  f.set("url", url);
  for (const a of arten) f.append("arten", a);
  return f;
};

const mitClient = (kind: React.ReactNode) =>
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{kind}</QueryClientProvider>);

describe("Webhook ändern: was gesendet wird", () => {
  it("sendet nichts, wenn nichts geändert ist", () => {
    expect(webhookAenderung(webhook, formular(webhook.name, webhook.url, webhook.arten))).toEqual({});
  });

  it("sendet nur Geändertes", () => {
    expect(webhookAenderung(webhook, formular("Neu", webhook.url, webhook.arten))).toEqual({ name: "Neu" });
    expect(
      webhookAenderung(webhook, formular(webhook.name, webhook.url, ["dokument.aufgenommen", "dokument.geloescht"])),
    ).toEqual({ arten: ["dokument.aufgenommen", "dokument.geloescht"] });
  });
});

describe("Webhook ändern: Formular", () => {
  it("belegt vor, haken die bisherigen Ereignisse an und stellt „Abbrechen“ vor „Speichern“", () => {
    const html = mitClient(<WebhookEditForm webhook={webhook} fertig={() => {}} />);
    expect(html).toContain('value="https://buchhaltung.example/belegt"');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="dokument.aufgenommen"/);
    expect([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((k) => k[1])).toEqual(["Abbrechen", "Speichern"]);
    expect(html).not.toContain("whsec_");
  });
});

describe("Webhook entfernen: Rückfrage", () => {
  it("fragt mit Namen und sagt, dass Zustellungen enden und es sich nicht rückgängig machen lässt", () => {
    const html = mitClient(<WebhookEdit webhook={webhook} inhaber />);
    expect(html).toContain("Webhook „Buchhaltung“ entfernen?");
    expect(html).toContain("nichts mehr an diese Adresse");
    expect(html).toContain("nicht rückgängig");
  });
});

describe("Webhook: nur für den Inhaber", () => {
  it("zeigt anderen weder „Ändern“ noch „Entfernen“", () => {
    expect(mitClient(<WebhookEdit webhook={webhook} inhaber={false} />)).toBe("");
  });
});

describe("Webhook: Aufrufe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ändert per PATCH und entfernt per DELETE", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(webhook)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.webhookAendern("w1", { url: "https://neu.example/x" });
    await api.webhookEntfernen("w1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/webhooks/w1");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "PATCH", body: '{"url":"https://neu.example/x"}' });
    expect(fetchMock.mock.calls[1]![1].method).toBe("DELETE");
  });
});
