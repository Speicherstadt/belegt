import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { ApiFehler, api } from "../lib/api.ts";
import { eingebettet, stillAnmeldenErlaubt } from "../lib/einbetten.ts";
import { AccountPage } from "../pages/AccountPage.tsx";
import { m } from "../paraglide/messages.js";
import { ServerAntwortetNicht } from "./Fehlerseiten.tsx";
import { Sidebar } from "./Sidebar.tsx";

export function Shell({ children }: { children: ReactNode }) {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const embedOrigin = status.data?.embedOrigin ?? null;
  const imFrame = !!embedOrigin && eingebettet(embedOrigin);
  const abgemeldet = ich.error instanceof ApiFehler && ich.error.status === 401;
  // Im Frame einmal still über den Anbieter anmelden; hat die Person dort eine Sitzung, kommt sie direkt zurück.
  // Einmal entschieden (null: noch nicht), denn stillAnmeldenErlaubt merkt sich den Versuch
  const [still, setStill] = useState<boolean | null>(null);
  useEffect(() => {
    if (!abgemeldet || !status.data || still !== null) return;
    const versuchen = imFrame && !!status.data.oidc && stillAnmeldenErlaubt();
    setStill(versuchen);
    if (versuchen) void api.anmeldenMitAnbieter(window.location.pathname, true).catch(() => setStill(false));
  }, [abgemeldet, status.data, still, imFrame]);
  if (abgemeldet && still === false) return <Navigate to="/anmelden" />;
  if (ich.error && !abgemeldet) return <ServerAntwortetNicht error={ich.error} erneut={() => void ich.refetch()} />;
  if (!ich.data) return <p className="p-8 text-muted text-sm">{m.loading()}</p>;
  return (
    <div className="flex min-h-screen flex-wrap bg-bg text-fg">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-onprimary"
      >
        {m.skip_link()}
      </a>
      <Sidebar ich={ich.data} eingebettet={imFrame} oidc={status.data?.oidc ?? null} version={status.data?.version} />
      <main id="inhalt" className="min-w-0 flex-[999_1_560px] px-4 py-6 sm:px-8">
        {/* Pflicht zum zweiten Faktor: bis er eingerichtet ist, auf jeder Seite die Einrichtung (der Server sperrt alles
            andere) */}
        {ich.data.zweiFaktorEinrichten ? <AccountPage /> : children}
      </main>
    </div>
  );
}
