import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErneutVersuchen, Meldung } from "./Meldung.tsx";

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
