import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShareLinks } from "./ShareLinks.tsx";

describe("ShareLinks", () => {
  it("gibt jedem Widerrufen-Knopf einen eigenen zugänglichen Namen mit dem Ablauf", () => {
    const client = new QueryClient();
    client.setQueryData(
      ["links", "d1"],
      [
        {
          id: "l1",
          erstelltVon: "a",
          erstelltAm: "2026-11-01T10:00:00Z",
          gueltigBis: "2026-11-08T10:00:00Z",
          abrufe: 0,
          letzterAbruf: null,
        },
        {
          id: "l2",
          erstelltVon: "a",
          erstelltAm: "2026-11-01T10:00:00Z",
          gueltigBis: "2026-12-01T10:00:00Z",
          abrufe: 0,
          letzterAbruf: null,
        },
      ],
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ShareLinks dokumentId="d1" />
      </QueryClientProvider>,
    );
    const namen = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
      .map(([, attribute, text]) => /aria-label="([^"]*)"/.exec(attribute!)?.[1] ?? text!)
      .filter((n) => /widerruf/i.test(n));
    expect(namen).toHaveLength(2);
    expect(new Set(namen).size).toBe(2);
  });
});
