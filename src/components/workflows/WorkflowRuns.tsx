import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../lib/api.ts";
import { zeitpunkt } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";

/** Die letzten Läufe, die etwas taten oder scheiterten; Fehler mit Meldung */
export function WorkflowRuns() {
  const laeufe = useQuery({ queryKey: ["workflowLaeufe"], queryFn: api.workflowLaeufe, refetchInterval: 10_000 });
  if (!laeufe.data) return null;
  if (!laeufe.data.length) return <p className="m-0 text-muted text-sm">{m.workflow_runs_none()}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-border border-b text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.workflow_runs_time()}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.workflow_name()}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {m.workflow_runs_document()}
            </th>
            <th scope="col" className="py-2 font-medium">
              {m.workflow_runs_result()}
            </th>
          </tr>
        </thead>
        <tbody>
          {laeufe.data.map((l) => (
            <tr key={l.id} className="border-border border-b align-top">
              <td className="py-2 pr-3 tabular-nums">{zeitpunkt(l.zeitpunkt)}</td>
              <td className="py-2 pr-3">{l.workflowName}</td>
              <td className="py-2 pr-3">
                <Link to="/dokumente/$id" params={{ id: l.dokumentId }} className="underline underline-offset-2">
                  {l.dateiname ?? m.start_asn({ asn: String(l.asn) })}
                </Link>
              </td>
              <td className={l.ergebnis === "fehler" ? "py-2 text-red-700 dark:text-red-400" : "py-2"}>
                {l.ergebnis === "fehler" ? m.workflow_runs_error({ meldung: l.fehler ?? "" }) : m.workflow_runs_done()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
