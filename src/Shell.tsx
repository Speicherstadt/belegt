import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { darfBearbeiten } from "../shared/rollen.ts";
import { DropUpload } from "./components/DropUpload.tsx";
import { ServerAntwortetNicht } from "./components/Fehlerseiten.tsx";
import { GlobalSearch } from "./components/GlobalSearch.tsx";
import { KOPFZEILE_ID } from "./components/Kopfzeile.tsx";
import { ProcessingBell } from "./components/ProcessingBell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ApiFehler, api } from "./lib/api.ts";
import { eingebettet, stillAnmeldenErlaubt } from "./lib/einbetten.ts";
import { AccountPage } from "./pages/AccountPage.tsx";
import { m } from "./paraglide/messages.js";

export function Shell({ children }: { children: ReactNode }) {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const embedOrigin = status.data?.embedOrigin ?? null;
  const imFrame = !!embedOrigin && eingebettet(embedOrigin);
  const abgemeldet = ich.error instanceof ApiFehler && ich.error.status === 401;
  // Im Frame einmal still über den Anbieter anmelden; hat die Person dort eine Sitzung, kommt sie direkt zurück.
  // Einmal entschieden (null: noch nicht), denn stillAnmeldenErlaubt merkt sich den Versuch
  const [still, setStill] = useState<boolean | null>(null);
  // Menü am Handy; ein Klick auf einen Link darin klappt es wieder zu (Sidebar, onNavigiert)
  const [menue, setMenue] = useState(false);
  useEffect(() => {
    if (!abgemeldet || !status.data || still !== null) return;
    const versuchen = imFrame && !!status.data.oidc && stillAnmeldenErlaubt();
    setStill(versuchen);
    if (versuchen) void api.anmeldenMitAnbieter(window.location.pathname, true).catch(() => setStill(false));
  }, [abgemeldet, status.data, still, imFrame]);
  if (abgemeldet && still === false) return <Navigate to="/anmelden" />;
  if (ich.error && !abgemeldet && !ich.data)
    return <ServerAntwortetNicht error={ich.error} erneut={() => void ich.refetch()} />;
  if (!ich.data) return <p className="p-8 text-muted text-sm">{m.loading()}</p>;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg md:flex-row">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-onprimary"
      >
        {m.skip_link()}
      </a>
      {/* Am Handy eine schmale Leiste mit Menü-Knopf statt der ganzen Navigation über dem Inhalt */}
      <header className="flex items-center justify-between gap-3 border-border border-b bg-side px-4 py-2 md:hidden print:hidden">
        <span className="font-semibold">{m.app_name()}</span>
        <button
          type="button"
          aria-expanded={menue}
          aria-controls="seitenleiste"
          onClick={() => setMenue(!menue)}
          className="flex h-10 items-center gap-2 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
        >
          <span aria-hidden="true">{menue ? "✕" : "☰"}</span>
          {m.menu()}
        </button>
      </header>
      <Sidebar
        ich={ich.data}
        eingebettet={imFrame}
        oidc={status.data?.oidc ?? null}
        version={status.data?.version}
        offen={menue}
        onNavigiert={() => setMenue(false)}
      />
      <main id="inhalt" className="min-w-0 flex-1">
        {/* Kopfleiste über dem Inhalt: links der Titel der Seite (InKopfzeile), rechts Suche und Verarbeitung; bleibt
            beim Scrollen stehen */}
        {!imFrame && !ich.data.zweiFaktorEinrichten && (
          <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-border border-b bg-bg/85 px-4 backdrop-blur sm:px-8 print:hidden">
            <div id={KOPFZEILE_ID} className="flex min-w-0 shrink-0 items-center" />
            <div className="ml-auto flex w-full max-w-md items-center gap-2">
              <GlobalSearch />
              {(ich.data.role === "inhaber" || ich.data.role === "steuerberatung") && <ProcessingBell />}
            </div>
          </div>
        )}
        <div className="px-4 py-6 sm:px-8">
          {/* Pflicht zum zweiten Faktor: bis er eingerichtet ist, auf jeder Seite die Einrichtung (der Server sperrt
              alles andere) */}
          {ich.data.zweiFaktorEinrichten ? <AccountPage /> : children}
        </div>
      </main>
      {!ich.data.zweiFaktorEinrichten && darfBearbeiten(ich.data) && <DropUpload />}
    </div>
  );
}
