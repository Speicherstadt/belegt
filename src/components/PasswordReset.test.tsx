import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PasswordReset, ResetErgebnis, ResetFehler } from "./PasswordReset.tsx";

const LINK = "http://localhost:3000/passwort/geheim-token-123";

describe("PasswordReset", () => {
  it("zeigt den Knopf mit dem Namen der Person und eine geschlossene Rückfrage mit Frage und Folgesatz", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <PasswordReset id="1" email="tom@example.org" knopf="k" />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="Passwort zurücksetzen: tom@example.org"');
    expect(html).toContain("Passwort für tom@example.org zurücksetzen?");
    expect(html).toContain("Alle Sitzungen enden");
    expect(html).toContain("24 Stunden und einmal");
    expect(html).toContain("Der zweite Faktor bleibt");
    expect(html).toMatch(/<button[^>]*>Link erstellen<\/button>/);
    // Vor der Bestätigung gibt es keinen Link
    expect(html).not.toContain('data-testid="einmalwert"');
  });

  it("meldet einen Fehler in drei Teilen mit dem Rohtext eingeklappt unter „Details“", () => {
    const html = renderToStaticMarkup(<ResetFehler details="Kein Zugang mit Passwort mit dieser ID" />);
    expect(html).toContain("Der Link wurde nicht erstellt.");
    expect(html).toContain("Es wurde kein Link erstellt, das Passwort bleibt wie es ist.");
    expect(html).toMatch(
      /<details><summary[^>]*>Details<\/summary><pre[^>]*>Kein Zugang mit Passwort mit dieser ID<\/pre>/,
    );
  });

  it("zeigt den Link einmal; der Satz in role=status enthält ihn nicht", () => {
    const html = renderToStaticMarkup(<ResetErgebnis email="tom@example.org" link={LINK} />);
    expect(html).toMatch(/<p role="status"[^>]*>Link für tom@example\.org erstellt<\/p>/);
    expect(html).toMatch(/<code [^>]*>http:\/\/localhost:3000\/passwort\/geheim-token-123<\/code>/);
    expect(html.split(LINK)).toHaveLength(2);
    expect(html).toContain("Wird nur jetzt angezeigt.");
  });
});
