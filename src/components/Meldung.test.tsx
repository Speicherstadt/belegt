import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiFehler } from "../lib/api.ts";
import { SeitenFehler, ServerAntwortetNicht } from "./Fehlerseiten.tsx";
import { ErneutVersuchen, Meldung } from "./Meldung.tsx";
import { Shell } from "./Shell.tsx";

// Seitenleiste und Konto brauchen einen Router; hier zählt nur, ob die Shell die Seite zeigt
vi.mock("./Sidebar.tsx", () => ({ Sidebar: () => null }));
vi.mock("../pages/AccountPage.tsx", () => ({ AccountPage: () => null }));

const zeigen = (details?: string) =>
  renderToStaticMarkup(
    <Meldung was="Etwas ging schief." verloren="Nichts ist verloren." details={details}>
      <ErneutVersuchen onClick={() => {}} />
    </Meldung>,
  );

describe("Meldung in drei Teilen", () => {
  it("nennt in der Überschrift, was passiert ist, dann ob etwas verloren ist, dann den Knopf", () => {
    const html = zeigen("boom");
    expect(html).toMatch(/<h1[^>]*>Etwas ging schief\.<\/h1>/);
    expect(html.indexOf("Nichts ist verloren.")).toBeLessThan(html.indexOf("<button"));
  });

  it("zeigt den Rohtext nur eingeklappt unter „Details“", () => {
    const html = zeigen("boom");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Details<\/summary><pre[^>]*>boom<\/pre>/);
    expect(html).not.toContain("<details open");
  });

  it("lässt die Details weg, wenn es keinen Rohtext gibt", () => {
    expect(zeigen(undefined)).not.toContain("<details");
  });
});

describe("Fehlerseiten", () => {
  it("SeitenFehler zeigt die Meldung mit Knopf, der reset aufruft, und den Rohtext unter Details", () => {
    let aufrufe = 0;
    const reset = () => {
      aufrufe++;
    };
    const el = SeitenFehler({ error: new Error("kaputt"), reset } as never);
    const html = renderToStaticMarkup(el);
    expect(html).toContain("<h1");
    expect(html).toMatch(/<pre[^>]*>kaputt<\/pre>/);
    const knopf = (el.props.children as ReactElement<{ onClick: () => void }>).props;
    knopf.onClick();
    expect(aufrufe).toBe(1);
  });

  it("ServerAntwortetNicht: 403 zeigt den Hinweis des Servers, 500 „antwortet nicht“ mit Details", () => {
    const fehler = (s: number, t: string) =>
      renderToStaticMarkup(<ServerAntwortetNicht error={new ApiFehler(s, t)} erneut={() => {}} />);
    const verweigert = fehler(403, "Sichtbereich ungültig; bitte den Inhaber fragen");
    expect(verweigert).toContain("Sichtbereich ungültig");
    expect(verweigert).not.toContain("antwortet gerade nicht");
    expect(verweigert).not.toContain("<details");
    for (const [status, text] of [
      [404, "404 page not found"],
      [403, ""],
    ] as const) {
      const html = fehler(status, text);
      expect(html).toContain("antwortet gerade nicht");
      expect(html).not.toContain("kann gerade nichts anzeigen");
    }
    const ausfall = fehler(500, "kaputt");
    expect(ausfall).toContain("antwortet gerade nicht");
    expect(ausfall).toMatch(/<details/);
  });
});

describe("Shell", () => {
  it("ersetzt die Seite nicht, wenn nur ein Abruf im Hintergrund scheiterte und Daten da sind", () => {
    const client = new QueryClient();
    const ich = { email: "a@example.org", role: "inhaber" };
    client
      .getQueryCache()
      .build(client, { queryKey: ["ich"] })
      .setState({
        data: ich,
        error: new ApiFehler(500, "kaputt"),
        status: "error",
      } as never);
    client.setQueryData(["status"], {});
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Shell>
          <p>Inhalt</p>
        </Shell>
      </QueryClientProvider>,
    );
    expect(html).toContain("Inhalt");
    expect(html).not.toContain("antwortet gerade nicht");
  });
});

describe("ServerAntwortetNicht mit echter Antwort", () => {
  it("hält ein 403 als HTML-Seite eines Proxys nicht für einen Hinweis des Servers", async () => {
    const { aufruf } = await import("../lib/api-aufruf.ts");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html><body><h1>403 Forbidden</h1></body></html>", { status: 403, statusText: "Forbidden" }),
      ),
    );
    const fehler = (await aufruf("/api/ich").catch((e: unknown) => e)) as Error;
    vi.unstubAllGlobals();
    const html = renderToStaticMarkup(<ServerAntwortetNicht error={fehler} erneut={() => {}} />);
    expect(html).toContain("antwortet gerade nicht");
    expect(html).not.toContain("kann gerade nichts anzeigen");
  });

  it("hält ein 403 mit Klartext eines Proxys nicht für einen Hinweis des Servers", async () => {
    const { aufruf } = await import("../lib/api-aufruf.ts");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 })),
    );
    const fehler = (await aufruf("/api/ich").catch((e: unknown) => e)) as Error;
    vi.unstubAllGlobals();
    const html = renderToStaticMarkup(<ServerAntwortetNicht error={fehler} erneut={() => {}} />);
    expect(html).toContain("antwortet gerade nicht");
    expect(html).not.toContain("kann gerade nichts anzeigen");
  });
});
