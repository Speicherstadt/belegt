import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.start_title()} intro={m.start_intro()} />
      {start.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {start.error.message}
        </p>
      )}
      {start.data && <StartNumbers start={start.data} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
        {start.data?.fristen && <UpcomingRetention fristen={start.data.fristen} />}
        {start.data?.quellen && <SourceStatus quellen={start.data.quellen} />}
        <ChainStatus />
      </div>
      <ViewTiles />
    </div>
  );
}
