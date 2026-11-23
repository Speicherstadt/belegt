import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Combine } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, type Eintrag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { name } from "./DocumentTable.tsx";
import { leistenKnopf } from "./leiste.ts";

const knopf = "h-8 rounded-md border border-border px-2 hover:bg-subtle disabled:opacity-60";

/**
 * Zusammenfügen aus der Leiste der Auswahl (SelectionBar): ein Knopf, wenn mindestens zwei PDFs und nur PDFs gewählt
 * sind. Er öffnet einen Dialog mit der Reihenfolge (zuerst die Reihenfolge der Klicks), damit in der Seite nichts
 * verrutscht. Das Ergebnis ist ein neues Dokument, die Originale bleiben.
 */
export function MergePdfs({ gewaehlt, fertig }: { gewaehlt: Eintrag[]; fertig: (meldung: string) => void }) {
  const queryClient = useQueryClient();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [offen, setOffen] = useState(false);
  const [ordnung, setOrdnung] = useState<string[]>([]);
  const jeId = new Map(gewaehlt.map((d) => [d.id, d]));
  const zusammenfuegen = useMutation({
    mutationFn: () => api.zusammenfuegen(ordnung),
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ["dokumente"] });
      setOffen(false);
      fertig(m.merge_done({ name: d.dateiname ?? m.unnamed() }));
    },
  });
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (offen && !d.open) d.showModal();
    else if (!offen && d.open) d.close();
  }, [offen]);

  if (gewaehlt.length < 2 || gewaehlt.some((d) => d.mimeType !== "application/pdf")) return null;
  const verschieben = (i: number, um: -1 | 1) => {
    const neu = [...ordnung];
    [neu[i], neu[i + um]] = [neu[i + um]!, neu[i]!];
    setOrdnung(neu);
  };
  const schliessen = () => {
    if (!zusammenfuegen.isPending) setOffen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          zusammenfuegen.reset();
          setOrdnung(gewaehlt.map((d) => d.id));
          setOffen(true);
        }}
        aria-label={m.merge_open({ anzahl: String(gewaehlt.length) })}
        title={m.merge_open({ anzahl: String(gewaehlt.length) })}
        aria-haspopup="dialog"
        className={leistenKnopf}
      >
        <Combine aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <span className="hidden lg:inline">{m.merge_short()}</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-titel`}
        aria-describedby={`${id}-hinweis`}
        onCancel={(e) => {
          e.preventDefault();
          schliessen();
        }}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-border bg-bg p-5 text-fg backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-3">
          <h2 id={`${id}-titel`} className="m-0 font-semibold text-lg">
            {m.merge_title()}
          </h2>
          <p id={`${id}-hinweis`} className="m-0 text-muted text-sm">
            {m.merge_hint()}
          </p>
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-6 text-sm">
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
            <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
              {zusammenfuegen.error.message}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={zusammenfuegen.isPending}
              onClick={schliessen}
              className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60"
            >
              {m.confirm_cancel()}
            </button>
            <button
              type="button"
              onClick={() => zusammenfuegen.mutate()}
              disabled={zusammenfuegen.isPending}
              className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
            >
              {m.merge_button({ anzahl: String(ordnung.length) })}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
