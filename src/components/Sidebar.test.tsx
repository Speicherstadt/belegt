import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Ich } from "../lib/api.ts";
import { Sidebar } from "./Sidebar.tsx";

async function leiste(role: Ich["role"], eingang?: number) {
  const client = new QueryClient();
  client.setQueryData(["ansichten"], []);
  // Dieselbe Abfrage wie die Liste „offen“ im Eingang: die Gesamtzahl
  if (eingang !== undefined)
    client.setQueryData(["dokumente", "", "offen", "", 1, 1, "neu"], { eintraege: [], gesamt: eingang });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <Sidebar ich={{ role } as Ich} eingebettet />,
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const gruppen = [...html.matchAll(/<p id="nav-[^"]+"[^>]*>([^<]+)<\/p>/g)].map((g) => g[1]);
  return { html, gruppen };
}

describe("Sidebar", () => {
  it("zeigt dem Inhaber alle drei Gruppen, jede als Liste mit ihrem Namen", async () => {
    const { html, gruppen } = await leiste("inhaber");
    expect(gruppen).toEqual(["Dokumente", "Ordnen und prüfen", "Einrichten"]);
    expect(html.match(/<ul aria-labelledby="nav-[a-z]+"/g)).toHaveLength(3);
    expect(html).toContain("Verfahrensdokumentation");
    expect(html).toContain("Benachrichtigungen");
  });

  it("zeigt dem Mitarbeiter nur Dokumente, dem Prüfer dazu nur die Prüfung", async () => {
    expect((await leiste("mitarbeiter")).gruppen).toEqual(["Dokumente"]);
    const pruefer = await leiste("pruefer");
    expect(pruefer.gruppen).toEqual(["Dokumente", "Ordnen und prüfen"]);
    expect(pruefer.html).toContain("Prüfung");
    expect(pruefer.html).not.toContain("Ordnung");
    expect(pruefer.html).not.toContain("Fristen");
  });

  it("zeigt Zugänge und Benachrichtigungen nur dem Inhaber", async () => {
    expect((await leiste("steuerberatung")).html).not.toContain("Zugänge");
    expect((await leiste("inhaber")).html).toContain("Zugänge");
  });

  it("zählt nur am Eingang und nicht bei 0", async () => {
    const { html } = await leiste("inhaber", 16);
    expect(html.match(/16 offene Dokumente/g)).toHaveLength(1);
    expect(html).toMatch(/Eingang<\/span><span[^>]*><span aria-hidden="true">16<\/span>/);
    expect((await leiste("inhaber", 1)).html).toContain("1 offenes Dokument");
    expect((await leiste("inhaber", 0)).html).not.toContain("offene");
    expect((await leiste("inhaber")).html).not.toContain("offene");
  });
});
