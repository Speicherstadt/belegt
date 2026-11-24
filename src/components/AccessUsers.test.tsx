import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Zugaenge } from "../lib/api.ts";
import { AccessUsers } from "./AccessUsers.tsx";

const konto = (email: string, rolle: Zugaenge["zugaenge"][number]["rolle"], entzogenAm: string | null = null) => ({
  id: email,
  email,
  rolle,
  zeitraumVon: null,
  zeitraumBis: null,
  recht: null,
  sichtbereich: null,
  entzogenAm,
  erstelltAm: "2026-11-01T10:00:00Z",
  zweiFaktor: { totp: false, passkeys: 0 },
  passwort: true,
});

describe("AccessUsers: Passwort zurücksetzen", () => {
  it("bietet den Knopf nur bei anderen, nicht entzogenen Zugängen an", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AccessUsers
          zugaenge={[
            konto("anna@example.org", "inhaber"),
            konto("tom@example.org", "steuerberatung"),
            konto("weg@example.org", "pruefer", "2026-11-02T10:00:00Z"),
            { ...konto("oidc@example.org", "steuerberatung"), passwort: false },
          ]}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="Passwort zurücksetzen: tom@example.org"');
    expect(html).not.toContain("Passwort zurücksetzen: anna@example.org");
    expect(html).not.toContain("Passwort zurücksetzen: weg@example.org");
    // Ohne Passwort (nur OIDC) gibt es nichts zurückzusetzen
    expect(html).not.toContain("Passwort zurücksetzen: oidc@example.org");
    // Der Link erscheint erst nach der Bestätigung
    expect(html).not.toContain('data-testid="einmalwert"');
  });
});
