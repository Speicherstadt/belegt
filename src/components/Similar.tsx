import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { Thumbnail } from "./Thumbnail.tsx";

/** Bis zu fünf ähnliche Dokumente aus dem Volltext; ohne Treffer nichts */
export function Similar({ dokumentId }: { dokumentId: string }) {
  const aehnliche = useQuery({ queryKey: ["aehnliche", dokumentId], queryFn: () => api.aehnliche(dokumentId) });
  if (!aehnliche.data?.length) return null;
  return (
    <section aria-labelledby="aehnliche" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="aehnliche" className="m-0 font-semibold text-base">
        {m.similar_title()}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {aehnliche.data.map((d) => (
          <li key={d.id} className="flex items-center gap-3 text-sm">
            <Thumbnail dokument={d} />
            <span className="min-w-0">
              <Link to="/dokumente/$id" params={{ id: d.id }} className="break-words underline underline-offset-2">
                {d.titel ?? d.dateiname ?? m.unnamed()}
              </Link>{" "}
              <span className="text-muted">
                ({m.col_asn()} {d.asn})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
