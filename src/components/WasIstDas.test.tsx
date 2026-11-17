import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Explain, GLOSSARY, TERMS } from "./WasIstDas.tsx";

const html = renderToStaticMarkup(
  <Explain term="asn">
    {(knopf, satz) => (
      <>
        <span>Archivnummer</span>
        {knopf}
        {satz}
      </>
    )}
  </Explain>,
);

describe("Explain", () => {
  it("hat einen Knopf, der zu ist und den Satz benennt", () => {
    expect(html).toMatch(/<button type="button"[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/);
    const id = /aria-controls="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`id="${id}"`);
  });

  it("benennt den Begriff im Namen des Knopfs und hält ihn in Zielgröße", () => {
    expect(html).toContain('aria-label="Was ist „ASN“?"');
    expect(html).toMatch(/<button[^>]*size-10[^>]*pointer-coarse:size-11/);
    expect(html).toContain("focus-visible:outline-2");
  });

  it("versteckt den Satz, solange der Knopf zu ist, und verlinkt das Glossar", () => {
    expect(html).toMatch(/<div [^>]*hidden=""[^>]*>.*fortlaufende Nummer/);
    expect(html).toContain(`href="${GLOSSARY}#asn"`);
    expect(html).toContain("Mehr im Glossar");
  });

  it("setzt den Satz auf dem Handy auf 16 px", () => {
    expect(html).toMatch(/<div [^>]*class="[^"]*\btext-base\b[^"]*\bsm:text-sm\b/);
  });

  it("öffnet das Glossar in einem neuen Tab ohne Referrer", () => {
    expect(html).toMatch(/<a [^>]*href="[^"]*#asn"[^>]*target="_blank"[^>]*rel="noreferrer"/);
  });

  it("hat im Glossar zu jedem Anker einen Eintrag", () => {
    const glossar = readFileSync("docs/glossar.md", "utf8");
    for (const { anchor } of Object.values(TERMS)) expect(glossar).toContain(`{ #${anchor} }`);
  });

  it("kennt zu jedem Begriff einen eigenen Anker im Glossar", () => {
    for (const term of ["seal", "chain", "hold", "kind"] as const) {
      const out = renderToStaticMarkup(<Explain term={term}>{(k, s) => [k, s]}</Explain>);
      expect(out).toMatch(new RegExp(`href="${GLOSSARY}#[a-z-]+"`));
    }
    expect(renderToStaticMarkup(<Explain term="chain">{(k, s) => [k, s]}</Explain>)).toContain("#hash-kette");
  });
});
