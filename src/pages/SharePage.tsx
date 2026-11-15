import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { darfBearbeiten } from "../../shared/rollen.ts";
import { EmptyState, PageHeader } from "../components/PageHeader.tsx";
import { api } from "../lib/api.ts";
import { groesse } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { geteilteDateien, geteilteVerwerfen, geteiltHochladen } from "../pwa/teilen.ts";

/**
 * Was vom Handy an Belegt geteilt wurde: erst ansehen, dann mit einem Klick in den Eingang. Bis dahin liegt nichts auf
 * dem Server; der Upload ist derselbe wie beim Hochladen, mit Anmeldung und CSRF-Prüfung.
 */
export function SharePage() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const dateien = useQuery({ queryKey: ["geteilt"], queryFn: geteilteDateien, gcTime: 0 });
  const fertig = async () => {
    await geteilteVerwerfen();
    await queryClient.invalidateQueries({ queryKey: ["geteilt"] });
  };
  const hochladen = useMutation({
    // Jede angekommene Datei verschwindet sofort aus der Zwischenablage; ein zweiter Versuch lädt nur den Rest hoch
    mutationFn: () => geteiltHochladen(api.hochladen),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["geteilt"] });
      await queryClient.invalidateQueries({ queryKey: ["dokumente"] });
    },
  });
  const verwerfen = useMutation({ mutationFn: fertig });
  const schreiben = darfBearbeiten(ich.data);
  const liste = dateien.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.share_title()} intro={m.share_intro()} />
      {hochladen.isSuccess && (
        <p role="status" className="m-0 flex flex-wrap items-center gap-3 text-sm">
          {m.share_done({ anzahl: String(hochladen.data) })}
          <Link to="/eingang" className="font-medium underline underline-offset-2">
            {m.share_to_inbox()}
          </Link>
        </p>
      )}
      {dateien.isSuccess && liste.length === 0 && !hochladen.isSuccess && (
        <EmptyState title={m.share_empty_title()} text={m.share_empty_text()} />
      )}
      {liste.length > 0 && (
        <>
          <ul aria-label={m.share_list_label()} className="m-0 flex list-none flex-col gap-2 p-0">
            {liste.map((d, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: Die Liste ändert sich nicht, Namen können doppelt sein
                key={i}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <span className="min-w-0 break-all font-medium">{d.name}</span>
                <span className="text-muted tabular-nums">
                  {d.type || "–"} · {groesse(d.size)}
                </span>
              </li>
            ))}
          </ul>
          {!schreiben && <p className="m-0 text-sm">{m.share_owner_only()}</p>}
          <div className="flex flex-wrap gap-3">
            {schreiben && (
              <button
                type="button"
                onClick={() => hochladen.mutate()}
                disabled={hochladen.isPending}
                className="h-10 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
              >
                {hochladen.isPending ? m.share_busy() : m.share_upload()}
              </button>
            )}
            <button
              type="button"
              onClick={() => verwerfen.mutate()}
              disabled={hochladen.isPending}
              className="h-10 rounded-md border border-border px-4 font-medium text-sm hover:bg-subtle disabled:opacity-60"
            >
              {m.share_discard()}
            </button>
          </div>
        </>
      )}
      {hochladen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.share_failed({ meldung: hochladen.error.message })}
        </p>
      )}
    </div>
  );
}
