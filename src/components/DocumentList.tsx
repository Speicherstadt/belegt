import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { api } from "../lib/api.ts";
import { groesse, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { EmptyState } from "./PageHeader.tsx";

/** Liste der Dokumente mit Suche und, für den Inhaber, Upload */
export function DocumentList({ suchbar, leer }: { suchbar: boolean; leer: { title: string; text: string } }) {
  const [suche, setSuche] = useState("");
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["dokumente", suche], queryFn: () => api.dokumente(suche) });
  const eingabe = useRef<HTMLInputElement>(null);
  const hochladen = useMutation({
    mutationFn: async (dateien: File[]) => {
      for (const datei of dateien) await api.hochladen(datei);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dokumente"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {suchbar && (
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <span className="sr-only">{m.archive_search()}</span>
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={m.archive_search()}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
          </label>
        )}
        {darfSchreiben(ich.data?.role) && (
          <>
            <input
              ref={eingabe}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const dateien = [...(e.target.files ?? [])];
                e.target.value = "";
                if (dateien.length) hochladen.mutate(dateien);
              }}
            />
            <button
              type="button"
              onClick={() => eingabe.current?.click()}
              disabled={hochladen.isPending}
              className="h-10 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
            >
              {hochladen.isPending ? m.upload_busy() : m.upload()}
            </button>
          </>
        )}
      </div>
      {hochladen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.upload_failed({ meldung: hochladen.error.message })}
        </p>
      )}
      {liste.data?.length === 0 && <EmptyState title={leer.title} text={leer.text} />}
      {!!liste.data?.length && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <section aria-label={m.list_label()} tabIndex={0} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-border border-b text-left text-muted">
                <th className="px-3 py-2.5 font-medium">{m.col_name()}</th>
                <th className="px-3 py-2.5 font-medium">{m.col_type()}</th>
                <th className="px-3 py-2.5 text-right font-medium">{m.col_size()}</th>
                <th className="px-3 py-2.5 text-right font-medium">{m.col_received()}</th>
              </tr>
            </thead>
            <tbody>
              {liste.data.map((d) => (
                <tr key={d.id} className="border-border border-b last:border-b-0 hover:bg-subtle">
                  <td className="px-3 py-3 font-medium">
                    <Link to="/dokumente/$id" params={{ id: d.id }} className="underline-offset-2 hover:underline">
                      {d.dateiname ?? m.unnamed()}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted">{d.mimeType}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{groesse(d.groesse)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{zeitpunkt(d.eingegangenAm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
