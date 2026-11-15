import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Eintrag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { name } from "./DocumentTable.tsx";

/**
 * Zusammenfügen über die Mehrfachauswahl: nur wenn alle gewählten PDFs sind. Die Reihenfolge lässt sich ändern; das
 * Ergebnis ist ein neues Dokument, die Originale bleiben.
 */
export function MergePdfs({ gewaehlt, fertig }: { gewaehlt: Eintrag[]; fertig: (meldung: string) => void }) {
  const queryClient = useQueryClient();
  const [reihenfolge, setReihenfolge] = useState<string[]>([]);
  const ids = gewaehlt.map((d) => d.id);
  // Was abgewählt ist, fällt heraus; neu Gewähltes kommt ans Ende
  const ordnung = [...reihenfolge.filter((id) => ids.includes(id)), ...ids.filter((id) => !reihenfolge.includes(id))];
  const jeId = new Map(gewaehlt.map((d) => [d.id, d]));
  const verschieben = (i: number, um: -1 | 1) => {
    const neu = [...ordnung];
    [neu[i], neu[i + um]] = [neu[i + um]!, neu[i]!];
    setReihenfolge(neu);
  };
  const zusammenfuegen = useMutation({
    mutationFn: () => api.zusammenfuegen(ordnung),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ["dokumente"] });
      setReihenfolge([]);
      fertig(m.merge_done({ name: d.dateiname ?? m.unnamed() }));
    },
  });
  if (gewaehlt.length < 2 || gewaehlt.some((d) => d.mimeType !== "application/pdf")) return null;

  return (
    <section aria-labelledby="zusammenfuegen" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="zusammenfuegen" className="m-0 font-semibold text-base">
        {m.merge_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.merge_hint()}</p>
      <ol className="m-0 flex flex-col gap-2 pl-6 text-sm">
        {ordnung.map((id, i) => (
          <li key={id}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 break-words">{name(jeId.get(id)!)}</span>
              <button
                type="button"
                onClick={() => verschieben(i, -1)}
                disabled={i === 0}
                aria-label={m.merge_up({ name: name(jeId.get(id)!) })}
                className="h-8 rounded-md border border-border px-2 hover:bg-subtle disabled:opacity-60"
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                onClick={() => verschieben(i, 1)}
                disabled={i === ordnung.length - 1}
                aria-label={m.merge_down({ name: name(jeId.get(id)!) })}
                className="h-8 rounded-md border border-border px-2 hover:bg-subtle disabled:opacity-60"
              >
                <span aria-hidden="true">↓</span>
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => zusammenfuegen.mutate()}
        disabled={zusammenfuegen.isPending}
        className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
      >
        {m.merge_button({ anzahl: String(ordnung.length) })}
      </button>
      {zusammenfuegen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {zusammenfuegen.error.message}
        </p>
      )}
    </section>
  );
}
