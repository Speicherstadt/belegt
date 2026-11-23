import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Eintrag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { name } from "./DocumentTable.tsx";

const knopf = "h-8 rounded-md border border-border px-2 hover:bg-subtle disabled:opacity-60";

/**
 * Zusammenfügen im Panel über der Leiste der Auswahl (SelectionBar), wie die übrigen Aktionen: die gewählten PDFs in
 * Reihenfolge der Klicks, mit ↑ ↓ umzusortieren. Das Ergebnis ist ein neues Dokument, die Originale bleiben.
 */
export function MergePdfs({ gewaehlt, fertig }: { gewaehlt: Eintrag[]; fertig: (meldung: string) => void }) {
  const queryClient = useQueryClient();
  const [ordnung, setOrdnung] = useState(() => gewaehlt.map((d) => d.id));
  const jeId = new Map(gewaehlt.map((d) => [d.id, d]));
  const zusammenfuegen = useMutation({
    mutationFn: () => api.zusammenfuegen(ordnung),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ["dokumente"] });
      fertig(m.merge_done({ name: d.dateiname ?? m.unnamed() }));
    },
  });
  const verschieben = (i: number, um: -1 | 1) => {
    const neu = [...ordnung];
    [neu[i], neu[i + um]] = [neu[i + um]!, neu[i]!];
    setOrdnung(neu);
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="m-0 text-muted">{m.merge_hint()}</p>
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-6">
        {ordnung.map((dok, i) => {
          const eintrag = jeId.get(dok);
          if (!eintrag) return null;
          return (
            <li key={dok}>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words">{name(eintrag)}</span>
                <button
                  type="button"
                  onClick={() => verschieben(i, -1)}
                  disabled={i === 0}
                  aria-label={m.merge_up({ name: name(eintrag) })}
                  className={knopf}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  onClick={() => verschieben(i, 1)}
                  disabled={i === ordnung.length - 1}
                  aria-label={m.merge_down({ name: name(eintrag) })}
                  className={knopf}
                >
                  <span aria-hidden="true">↓</span>
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {zusammenfuegen.error && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {zusammenfuegen.error.message}
        </p>
      )}
      <button
        type="button"
        onClick={() => zusammenfuegen.mutate()}
        disabled={zusammenfuegen.isPending}
        className="h-9 self-end rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
      >
        {m.merge_button({ anzahl: String(ordnung.length) })}
      </button>
    </div>
  );
}
