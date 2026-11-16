import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const zeigen = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <ConfirmDialog
      open
      titel="Dokument jetzt löschen?"
      folge="Die Datei wird endgültig entfernt."
      verb="Jetzt löschen"
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );
const knoepfe = (html: string) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];

// Fokus, Escape und das Zurückkehren des Fokus braucht einen Browser: e2e/loeschung.spec.ts
describe("ConfirmDialog", () => {
  it("nennt Frage und Folgesatz im Dialog und setzt das Verb als letzten Knopf hinter „Abbrechen“", () => {
    const html = zeigen();
    expect(html).toContain("<dialog");
    expect(html).toContain("Dokument jetzt löschen?");
    expect(html).toContain("Die Datei wird endgültig entfernt.");
    expect(knoepfe(html).map((k) => k[2])).toEqual(["Abbrechen", "Jetzt löschen"]);
  });

  it("verlangt mit Häkchen-Text das Häkchen und sperrt bis dahin nur das Bestätigen", () => {
    const html = zeigen({ haken: "Ich habe geprüft." });
    expect(html).toMatch(/<input type="checkbox"/);
    expect(html).toContain("Ich habe geprüft.");
    const [abbrechen, bestaetigen] = knoepfe(html);
    expect(abbrechen![1]).not.toContain('disabled=""');
    expect(bestaetigen![1]).toContain('disabled=""');
  });

  it("lässt ohne Häkchen-Text sofort bestätigen und zeigt keine Checkbox", () => {
    const html = zeigen();
    expect(html).not.toContain('type="checkbox"');
    expect(knoepfe(html)[1]![1]).not.toContain('disabled=""');
  });

  it("sperrt das Bestätigen, solange es läuft, und zeigt einen Fehler als Hinweis", () => {
    const html = zeigen({ pending: true, fehler: "Nicht erlaubt" });
    expect(knoepfe(html)[1]![1]).toContain('disabled=""');
    expect(html).toMatch(/role="alert"[^>]*>Nicht erlaubt</);
  });
});
