import { useQuery } from "@tanstack/react-query";
import { darfSchreiben } from "../../shared/rollen.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { WorkflowForm } from "../components/workflows/WorkflowForm.tsx";
import { WorkflowList } from "../components/workflows/WorkflowList.tsx";
import { WorkflowRuns } from "../components/workflows/WorkflowRuns.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const abschnitt = "flex flex-col gap-3";

/** Workflows: Liste in Reihenfolge, neuer Workflow (nur Inhaber) und die letzten Läufe */
export function WorkflowsPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={m.workflows_title()} intro={m.workflows_intro()} />
      <section aria-labelledby="workflows-liste" className={abschnitt}>
        <h2 id="workflows-liste" className="m-0 font-semibold text-lg">
          {m.workflows_list()}
        </h2>
        <WorkflowList />
      </section>
      {darfSchreiben(ich.data?.role) && (
        <section aria-labelledby="workflows-neu" className={abschnitt}>
          <h2 id="workflows-neu" className="m-0 font-semibold text-lg">
            {m.workflows_new()}
          </h2>
          <WorkflowForm />
        </section>
      )}
      <section aria-labelledby="workflows-laeufe" className={abschnitt}>
        <h2 id="workflows-laeufe" className="m-0 font-semibold text-lg">
          {m.workflows_runs()}
        </h2>
        <WorkflowRuns />
      </section>
    </div>
  );
}
