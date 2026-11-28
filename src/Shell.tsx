import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { darfBearbeiten } from "../shared/rollen.ts";
import { DropUpload } from "./components/DropUpload.tsx";
import { ServerAntwortetNicht } from "./components/Fehlerseiten.tsx";
import { GlobalSearch } from "./components/GlobalSearch.tsx";
import { KOPFZEILE_ID } from "./components/Kopfzeile.tsx";
import { ProcessingBell } from "./components/ProcessingBell.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { DemoHinweis } from "./demo/DemoHinweis.tsx";
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
  const menueKnopf = useRef<HTMLButtonElement>(null);
  // Der Wechsel auf die dauerhafte Leiste (ab 1024 px) klappt das Menü zu; den Seitenwechsel meldet die Sidebar
  useEffect(() => {
    const breit = window.matchMedia("(min-width: 1024px)");
    const zuklappen = () => breit.matches && setMenue(false);
    breit.addEventListener("change", zuklappen);
    return () => breit.removeEventListener("change", zuklappen);
  }, []);
  // Escape schließt das Menü und gibt den Fokus an den Knopf zurück
  useEffect(() => {
    if (!menue) return;
    const schliessen = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenue(false);
      menueKnopf.current?.focus();
    };
    document.addEventListener("keydown", schliessen);
    return () => document.removeEventListener("keydown", schliessen);
  }, [menue]);
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
    <div className="flex min-h-screen flex-col bg-bg text-fg lg:flex-row">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-onprimary"
      >
        {m.skip_link()}
      </a>
      {/* Unter 1024 px eine schmale Leiste mit Menü-Knopf; die Seitenleiste öffnet darunter als Fläche über dem Inhalt */}
      <header
        className={`${menue ? "sticky top-0 z-40 " : ""}flex h-14 items-center justify-between gap-3 border-border border-b bg-side px-4 lg:hidden print:hidden`}
      >
        <span className="font-semibold">{m.app_name()}</span>
        <button
          type="button"
          ref={menueKnopf}
          aria-expanded={menue}
          aria-controls="seitenleiste"
          onClick={() => setMenue(!menue)}
          className="flex h-(--control-h) items-center gap-2 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
        >
          {menue ? <X aria-hidden="true" className="size-4" /> : <Menu aria-hidden="true" className="size-4" />}
          {m.menu()}
        </button>
      </header>
      {/* Hinter der offenen Seitenleiste: ein Klick schließt; Tastatur und Menü-Knopf haben Escape und „Menü“ */}
      {menue && (
        <div
          aria-hidden="true"
          onClick={() => setMenue(false)}
          className="fixed inset-x-0 top-14 bottom-0 z-40 bg-(--scrim) lg:hidden"
        />
      )}
      <Sidebar
        ich={ich.data}
        eingebettet={imFrame}
        oidc={status.data?.oidc ?? null}
        version={status.data?.version}
        offen={menue}
        onNavigiert={() => setMenue(false)}
      />
      <main id="inhalt" inert={menue} className="min-w-0 flex-1">
        {import.meta.env.MODE === "demo" && <DemoHinweis />}
        {/* Kopfleiste über dem Inhalt: links der Titel der Seite (InKopfzeile), rechts Suche und Verarbeitung; bleibt
            beim Scrollen stehen */}
        {!imFrame && !ich.data.zweiFaktorEinrichten && (
          <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-border border-b bg-bg/85 px-4 backdrop-blur sm:px-8 print:hidden">
            <div id={KOPFZEILE_ID} className="flex max-w-[50%] shrink-0 items-center" />
            <div className="ml-auto flex min-w-0 max-w-md flex-1 items-center justify-end gap-2">
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
      {!ich.data.zweiFaktorEinrichten && darfBearbeiten(ich.data) && (
        <div inert={menue}>
          <DropUpload />
        </div>
      )}
    </div>
  );
}
