import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
import { FirstSteps } from "../components/start/FirstSteps.tsx";
import { OperationStatus } from "../components/start/OperationStatus.tsx";
import { StartNumbers, UpcomingRetention } from "../components/start/StartNumbers.tsx";
import { ChainStatus, SourceStatus } from "../components/start/SystemStatus.tsx";
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
      {/* Zuerst der Überblick: Zahlen, dann Fristen, Quellen, Siegel und Betrieb; danach die gespeicherten Ansichten */}
      {start.data && <StartNumbers start={start.data} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {start.data?.fristen && <UpcomingRetention fristen={start.data.fristen} />}
        {start.data?.quellen && <SourceStatus quellen={start.data.quellen} />}
        {/* Die Prüfung der Kette ist nichts für Mitarbeiter; der Server lehnt sie für sie ab */}
        {ich.data && ich.data.role !== "mitarbeiter" && <ChainStatus inhaber={ich.data.role === "inhaber"} />}
        {/* Betrieb nur für Inhaber und Steuerberatung; der Server lehnt es für andere ab */}
        {ich.data && (ich.data.role === "inhaber" || ich.data.role === "steuerberatung") && (
          <OperationStatus inhaber={ich.data.role === "inhaber"} />
        )}
      </div>
      <ViewTiles />
    </div>
  );
}
