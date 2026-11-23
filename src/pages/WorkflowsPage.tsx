import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { EmptyState, PageHeader } from "../components/PageHeader.tsx";
import { WorkflowForm } from "../components/workflows/WorkflowForm.tsx";
import { WorkflowList } from "../components/workflows/WorkflowList.tsx";
import { WorkflowRuns } from "../components/workflows/WorkflowRuns.tsx";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const abschnitt = "flex flex-col gap-3";

function NeuKnopf({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 shrink-0 rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
    >
      + {m.workflows_new()}
    </button>
  );
}

/**
 * Workflows: „+ Neuer Workflow“ als Hauptaktion oben neben der Erklärung (nur wer schreiben darf), das Formular darunter,
 * dann die Liste in Reihenfolge und die letzten Läufe. Ohne Workflows steht statt der Liste ein leerer Zustand mit dem
 * Knopf in der Mitte.
 */
export function WorkflowsPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["workflows"], queryFn: api.workflows });
  const [neu, setNeu] = useState(false);
  const schreiben = darfSchreiben(ich.data?.role);
  const leer = liste.data?.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.workflows_title()} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="m-0 max-w-3xl text-muted text-sm">{m.workflows_intro()}</p>
        {schreiben && !neu && !leer && <NeuKnopf onClick={() => setNeu(true)} />}
      </div>
      {neu && (
        <section aria-labelledby="workflows-neu" className={abschnitt}>
          <h2 id="workflows-neu" className="m-0 font-semibold text-lg">
            {m.workflows_new()}
          </h2>
          <WorkflowForm onFertig={() => setNeu(false)} onAbbrechen={() => setNeu(false)} />
        </section>
      )}
      {leer && !neu ? (
        <EmptyState title={m.workflows_none()} text={m.workflows_empty_text()} bereich="/workflows">
          {schreiben && (
            <div className="mt-2">
              <NeuKnopf onClick={() => setNeu(true)} />
            </div>
          )}
        </EmptyState>
      ) : (
        !leer && (
          <section aria-labelledby="workflows-liste" className={abschnitt}>
            <h2 id="workflows-liste" className="m-0 font-semibold text-lg">
              {m.workflows_list()}
            </h2>
            <WorkflowList />
          </section>
        )
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
