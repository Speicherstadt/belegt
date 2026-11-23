import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstSteps } from "./FirstSteps.tsx";

describe("FirstSteps", () => {
  it("zeigt vier Schritte mit Links, den Umzug aus Paperless-ngx darunter", () => {
    const html = renderToStaticMarkup(<FirstSteps />);
    expect(html).toContain("Erste Schritte");
    expect([...html.matchAll(/<a href="([^"]+)"/g)].map((a) => a[1])).toEqual([
      "/eingang",
      "/quellen",
      "/quellen?bereich=umzug",
      "/eingang#unterwegs",
    ]);
    expect(html).toContain("Aus Paperless-ngx übernehmen");
  });
});
