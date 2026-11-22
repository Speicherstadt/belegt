import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
import { FirstSteps } from "../components/start/FirstSteps.tsx";
import { OperationStatus } from "../components/start/OperationStatus.tsx";
import { UpcomingRetention } from "../components/start/StartNumbers.tsx";
import { ChainStatus, SourceStatus } from "../components/start/SystemStatus.tsx";
import { Ueberblick } from "../components/start/Ueberblick.tsx";
import { ViewTiles } from "../components/start/ViewTiles.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/**
 * Startseite: Zahlen, Fristen der nächsten 90 Tage, Zustand der Quellen und der Kette, dazu Kacheln aus gespeicherten
 * Ansichten. Was eine Rolle nicht sehen darf, liefert der Server gar nicht erst (server/start/start.ts).
 */
export function StartPage() {
  const start = useQuery({ queryKey: ["start"], queryFn: api.start });
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.start_title()} intro={m.start_intro()} />
      {start.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {start.error.message}
        </p>
      )}
      {/* Leeres Archiv: erst die ersten Schritte, für den, der einrichtet */}
      {start.data?.gesamt === 0 && ich.data?.role === "inhaber" && <FirstSteps />}
      {/* Zuerst der Überblick, darunter links die gespeicherten Ansichten und rechts der Zustand */}
      {start.data && <Ueberblick start={start.data} />}
      {/* Breit die gespeicherten Ansichten, daneben der Zustand untereinander: jede Karte so hoch wie ihr Inhalt */}
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <ViewTiles />
        </div>
        {/* Mit eigener Überschrift, damit die Karten oben auf einer Linie mit den Ansichten links beginnen */}
        <section aria-labelledby="start-zustand" className="flex min-w-0 flex-col gap-3">
          <h2 id="start-zustand" className="m-0 font-semibold text-lg">
            {m.start_state()}
          </h2>
          {/* Die Prüfung der Kette ist nichts für Mitarbeiter; der Server lehnt sie für sie ab */}
          {ich.data && ich.data.role !== "mitarbeiter" && <ChainStatus inhaber={ich.data.role === "inhaber"} />}
          {start.data?.fristen && <UpcomingRetention fristen={start.data.fristen} />}
          {start.data?.quellen && <SourceStatus quellen={start.data.quellen} />}
          {/* Betrieb nur für Inhaber und Steuerberatung; der Server lehnt es für andere ab */}
          {ich.data && (ich.data.role === "inhaber" || ich.data.role === "steuerberatung") && (
            <OperationStatus inhaber={ich.data.role === "inhaber"} />
          )}
        </section>
      </div>
    </div>
  );
}
