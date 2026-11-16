import { useQuery } from "@tanstack/react-query";
import { api, type Weitergabe } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const STAND: Record<Weitergabe["stand"], () => string> = {
  offen: () => m.forward_open(),
  gesendet: () => m.forward_sent(),
  fehlgeschlagen: () => m.forward_failed(),
  entfallen: () => m.forward_dropped(),
};

/** Wohin Workflows das Original gesendet haben (Aktion „Original an Adresse senden“); nichts, wenn es keine gibt */
export function Forwardings({ dokumentId }: { dokumentId: string }) {
  const liste = useQuery({ queryKey: ["weitergaben", dokumentId], queryFn: () => api.weitergaben(dokumentId) });
  if (!liste.data?.length) return null;
  return (
    <section aria-labelledby="weitergaben" className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 id="weitergaben" className="m-0 font-semibold text-base">
        {m.forward_title()}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
        {liste.data.map((w) => (
          <li key={w.id} className="flex flex-col">
            <span className="break-words">
              <span className="font-medium">{w.workflowName}</span>
              {w.ziel ? ` → ${w.ziel}` : ""}:{" "}
              <span className={w.stand === "fehlgeschlagen" ? "text-red-700 dark:text-red-400" : ""}>
                {STAND[w.stand]()}
              </span>
            </span>
            <span className="break-words text-muted text-xs">
              {[
                w.gesendetAm
                  ? zeitpunkt(w.gesendetAm)
                  : w.letzterVersuch
                    ? m.forward_last_try({ zeit: zeitpunkt(w.letzterVersuch) })
                    : null,
                w.httpStatus !== null ? m.forward_status({ status: String(w.httpStatus) }) : null,
                w.versuche > 1 ? m.forward_tries({ anzahl: String(w.versuche) }) : null,
                w.fehler,
                w.naechsterVersuch ? m.forward_next({ zeit: zeitpunkt(w.naechsterVersuch) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
