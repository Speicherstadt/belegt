import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { darfSchreiben } from "../../../shared/rollen.ts";
import { api, type Workflow } from "../../lib/api.ts";
import { m } from "../../paraglide/messages.js";
import { AUSLOESER_LABEL, aktionText, bedingungenText } from "./labels.ts";

const knopf = "h-8 rounded-md border border-border px-2.5 font-medium text-sm hover:bg-subtle disabled:opacity-60";

/** Die Workflows in ihrer Reihenfolge: Auslöser, Bedingungen, Aktionen; der Inhaber schaltet, ordnet und löscht */
export function WorkflowList() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  const neu = () => queryClient.invalidateQueries({ queryKey: ["workflows"] });
  const schalten = useMutation({
    mutationFn: ({ id, aktiv }: { id: string; aktiv: boolean }) => api.workflowSchalten(id, aktiv),
    onSuccess: neu,
  });
  const loeschen = useMutation({ mutationFn: api.workflowLoeschen, onSuccess: neu });
  const ordnen = useMutation({ mutationFn: api.workflowsOrdnen, onSuccess: neu });
  const schreiben = darfSchreiben(ich.data?.role);
  const workflows = liste.data ?? [];
  const verschieben = (i: number, um: -1 | 1) => {
    const ids = workflows.map((w) => w.id);
    [ids[i], ids[i + um]] = [ids[i + um]!, ids[i]!];
    ordnen.mutate(ids);
  };
  const fehler = schalten.error ?? loeschen.error ?? ordnen.error;

  if (liste.data && !workflows.length) return <p className="m-0 text-muted text-sm">{m.workflows_none()}</p>;
  return (
    <>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {workflows.map((w: Workflow, i) => (
          <li key={w.id} className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 font-semibold text-base">
                {w.name}
                {!w.aktiv && <span className="ml-2 font-normal text-muted">({m.workflow_inactive()})</span>}
              </h3>
              {schreiben && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={knopf}
                    disabled={i === 0 || ordnen.isPending}
                    onClick={() => verschieben(i, -1)}
                    aria-label={m.workflow_up({ name: w.name })}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={knopf}
                    disabled={i === workflows.length - 1 || ordnen.isPending}
                    onClick={() => verschieben(i, 1)}
                    aria-label={m.workflow_down({ name: w.name })}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={knopf}
                    onClick={() => schalten.mutate({ id: w.id, aktiv: !w.aktiv })}
                    aria-label={(w.aktiv ? m.workflow_deactivate : m.workflow_activate)({ name: w.name })}
                  >
                    {w.aktiv ? m.workflow_deactivate_short() : m.workflow_activate_short()}
                  </button>
                  <button
                    type="button"
                    className={knopf}
                    onClick={() => loeschen.mutate(w.id)}
                    aria-label={m.workflow_delete({ name: w.name })}
                  >
                    {m.views_delete_short()}
                  </button>
                </div>
              )}
            </div>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">{m.workflow_trigger()}</dt>
              <dd className="m-0">{AUSLOESER_LABEL[w.ausloeser]()}</dd>
              <dt className="text-muted">{m.workflow_conditions()}</dt>
              <dd className="m-0">
                {bedingungenText(w, tags.data ?? [], typen.data ?? [], korrespondenten.data ?? []).join(" · ")}
              </dd>
              <dt className="text-muted">{m.workflow_actions()}</dt>
              <dd className="m-0">
                {w.aktionen
                  .map((a) => aktionText(a, tags.data ?? [], typen.data ?? [], korrespondenten.data ?? []))
                  .join(" · ")}
                {w.anhalten && ` · ${m.workflow_stops()}`}
              </dd>
            </dl>
          </li>
        ))}
      </ol>
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {fehler.message}
        </p>
      )}
    </>
  );
}
