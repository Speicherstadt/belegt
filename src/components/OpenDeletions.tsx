import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { kannBestaetigen } from "./Deletion.tsx";

/** Offene Anträge auf der Seite Fristen, zum Bestätigen durch die zweite Person */
export function OpenDeletions() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["loeschungen"], queryFn: api.loeschungen });
  const bestaetigen = useMutation({
    mutationFn: api.loeschungBestaetigen,
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const offen = liste.data?.filter((l) => !l.bestaetigtAm) ?? [];
  return (
    <section aria-labelledby="offene-loeschungen" className="flex flex-col gap-3">
      <h2 id="offene-loeschungen" className="m-0 font-semibold text-base">
        {m.delete_open_title()}
      </h2>
      {offen.length === 0 && <p className="m-0 text-sm">{m.delete_open_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {offen.map((l) => (
          <li
            key={l.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
          >
            <span className="flex flex-col">
              <Link
                to="/dokumente/$id"
                params={{ id: l.dokumentId }}
                className="font-medium underline-offset-2 hover:underline"
              >
                {l.dateiname ?? m.unnamed()}
              </Link>
              <span className="text-muted">
                {m.delete_requested({ wer: l.beantragtVon, wann: zeitpunkt(l.beantragtAm) })}
              </span>
            </span>
            {kannBestaetigen(l, ich.data) && (
              <button
                type="button"
                onClick={() => bestaetigen.mutate(l.id)}
                className="h-8 rounded-md bg-primary px-3 font-medium text-onprimary"
              >
                {m.delete_confirm()}
              </button>
            )}
          </li>
        ))}
      </ul>
      {bestaetigen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.delete_failed({ meldung: bestaetigen.error.message })}
        </p>
      )}
    </section>
  );
}
