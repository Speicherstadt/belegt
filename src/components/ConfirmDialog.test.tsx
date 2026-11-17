import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, nachSchliessen } from "./ConfirmDialog.tsx";

const zeigen = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) =>
  renderToStaticMarkup(
    <ConfirmDialog
      open
      titel="Dokument jetzt löschen?"
      folge="Das Dokument wird endgültig gelöscht."
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
    expect(html).toContain("Das Dokument wird endgültig gelöscht.");
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
    // Auch „Abbrechen“ ist gesperrt, sonst ginge ein laufender Fehler im geschlossenen Dialog verloren
    expect(knoepfe(html).map((k) => k[1]?.includes('disabled=""'))).toEqual([true, true]);
    expect(html).toMatch(/role="alert"[^>]*>Nicht erlaubt</);
  });

  describe("nachSchliessen (Browser schließt selbst)", () => {
    it("öffnet den Dialog wieder, solange es läuft, und meldet keinen Abbruch", () => {
      const dialog = { showModal: vi.fn() };
      const onCancel = vi.fn();
      nachSchliessen(true, true, dialog, onCancel);
      expect(dialog.showModal).toHaveBeenCalledOnce();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("meldet sonst den Abbruch, damit der Elternzustand zurückfällt", () => {
      const dialog = { showModal: vi.fn() };
      const onCancel = vi.fn();
      nachSchliessen(true, false, dialog, onCancel);
      expect(onCancel).toHaveBeenCalledOnce();
      expect(dialog.showModal).not.toHaveBeenCalled();
    });

    it("tut nichts, wenn der Elternteil den Dialog selbst geschlossen hat", () => {
      const dialog = { showModal: vi.fn() };
      const onCancel = vi.fn();
      nachSchliessen(false, true, dialog, onCancel);
      expect(dialog.showModal).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
