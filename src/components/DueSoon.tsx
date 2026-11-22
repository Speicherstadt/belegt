import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { verwaltungsKarte } from "./Ausklappbar.tsx";
import { name } from "./DocumentTable.tsx";

/** Die Dokumente, deren Frist als nächstes endet: oben auf der Fristen-Seite, mit dem Weg ins Archiv */
export function DueSoon() {
  const liste = useQuery({
    queryKey: ["dokumente", "", "alle", "", 1, 25, "frist"],
    queryFn: () => api.dokumente("", "alle", "", 1, 25, "frist"),
  });
  const mitFrist = (liste.data?.eintraege ?? []).filter((d) => d.fristBis).slice(0, 8);
  return (
    <section aria-labelledby="bald-faellig" className={verwaltungsKarte}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="bald-faellig" className="m-0 font-semibold text-base">
          {m.due_title()}
        </h2>
        <Link to="/archiv" search={{ sortierung: "frist" }} className="text-sm underline underline-offset-2">
          {m.due_all()}
        </Link>
      </div>
      {liste.data && !mitFrist.length && <p className="m-0 text-muted text-sm">{m.due_none()}</p>}
      {!!mitFrist.length && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0 text-sm">
          {mitFrist.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <Link
                to="/dokumente/$id"
                params={{ id: d.id }}
                className="min-w-0 truncate font-medium underline-offset-2 hover:underline"
              >
                {name(d)}
              </Link>
              <span className="shrink-0 text-muted tabular-nums">{m.due_until({ datum: tag(d.fristBis!) })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
