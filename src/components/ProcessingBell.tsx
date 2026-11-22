import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/**
 * Glocke in der Kopfzeile: zeigt, wie viele Dokumente der Worker noch liest. Solange etwas offen ist, fragt sie alle
 * fünf Sekunden nach, sonst jede halbe Minute; wird es fertig, laden die Listen neu (Volltext, Vorschläge)
 */
export function ProcessingBell() {
  const queryClient = useQueryClient();
  const [offen, setOffen] = useState(false);
  const stand = useQuery({
    queryKey: ["verarbeitung"],
    queryFn: api.verarbeitung,
    refetchInterval: (q) => ((q.state.data?.textOffen ?? 0) > 0 ? 5_000 : 30_000),
  });
  const anzahl = stand.data?.textOffen ?? 0;
  const vorher = useRef(0);
  useEffect(() => {
    if (vorher.current > anzahl) void queryClient.invalidateQueries({ queryKey: ["dokumente"] });
    vorher.current = anzahl;
  }, [anzahl, queryClient]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={offen}
        aria-label={anzahl ? m.bell_busy({ anzahl: String(anzahl) }) : m.bell_idle()}
        onClick={() => setOffen(!offen)}
        className="relative flex size-9 items-center justify-center rounded-md border border-border hover:bg-subtle"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {!!anzahl && (
          <span className="-top-1.5 -right-1.5 absolute rounded-full bg-primary px-1.5 text-onprimary text-xs tabular-nums">
            {anzahl}
          </span>
        )}
      </button>
      {offen && (
        <div
          role="status"
          className="absolute top-11 right-0 z-30 w-72 rounded-lg border border-border bg-bg p-3 text-sm shadow-lg"
        >
          {anzahl ? m.bell_busy_text({ anzahl: String(anzahl) }) : m.bell_idle_text()}
        </div>
      )}
    </div>
  );
}
