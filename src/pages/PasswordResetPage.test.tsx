import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PasswordResetKarte } from "./PasswordResetPage.tsx";

// Link braucht einen Router; hier zählt, was die Karte zeigt
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: unknown; className?: string }) => (
    <a href="/anmelden" className={className}>
      {children as string}
    </a>
  ),
  useParams: () => ({ token: "t" }),
}));

const zeigen = (zustand: "formular" | "fehler" | "erfolg", details?: string) =>
  renderToStaticMarkup(<PasswordResetKarte zustand={zustand} absenden={() => {}} pending={false} details={details} />);

describe("PasswordResetPage", () => {
  it("zeigt das Formular mit Hinweis außerhalb des Labels, nur über aria-describedby, in Lesegröße", () => {
    const html = zeigen("formular");
    expect(html).toMatch(/<form[^>]*noValidate/);
    expect(html).toMatch(/<h1[^>]*>Neues Passwort festlegen<\/h1>/);
    const label = /<label[^>]*>([^<]*)<\/label>/.exec(html);
    expect(label![1]).toBe("Passwort");
    expect(html).toMatch(/<input[^>]*type="password"[^>]*text-base sm:text-sm/);
    expect(html).toMatch(/<input[^>]*aria-describedby="([^"]+)-hinweis"/);
    expect(html).toMatch(/<p id="[^"]+-hinweis"[^>]*text-sm[^>]*>Mindestens 12 Zeichen<\/p>/);
    expect(html).toMatch(/<button type="submit"[^>]*text-base[^>]*sm:text-sm[^>]*>Passwort speichern<\/button>/);
    // Ohne Eingabe noch kein Fehler
    expect(html).not.toContain('role="alert"');
  });

  it("zeigt bei einem Fehler die Meldung in drei Teilen in role=alert, den Rohtext unter „Details“", () => {
    const html = zeigen("fehler", "Der Link ist ungültig");
    expect(html).toMatch(/<div role="alert"><section[^>]*><h1[^>]*>Das Passwort wurde nicht geändert\.<\/h1>/);
    expect(html).toContain("Dein altes Passwort gilt weiter.");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Details<\/summary><pre[^>]*>Der Link ist ungültig<\/pre>/);
    expect(html).toContain("Zur Anmeldung");
    expect(html).not.toContain("<form");
  });

  it("zeigt bei Erfolg eine Überschrift, den Satz in role=status und den Weg zur Anmeldung", () => {
    const html = zeigen("erfolg");
    expect(html).toMatch(/<h1[^>]*>Passwort gespeichert<\/h1>/);
    expect(html).toMatch(/<p role="status"[^>]*>Dein neues Passwort gilt\./);
    expect(html).toContain("Zur Anmeldung");
  });
});
