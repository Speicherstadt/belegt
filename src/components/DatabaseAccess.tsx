import { useQuery } from "@tanstack/react-query";
import { api, type DatenbankProblem } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

export const ROLLEN_DOKU = "https://belegt.net/betrieb.html#getrennte-datenbankrollen";

export const PROBLEM: Record<DatenbankProblem, () => string> = {
  rollenwechsel: () => m.db_problem_rollenwechsel(),
  replika: () => m.db_problem_replika(),
  admin: () => m.db_problem_admin(),
  eigentuemer: () => m.db_problem_eigentuemer(),
  anlegen: () => m.db_problem_anlegen(),
  temporaer: () => m.db_problem_temporaer(),
  replikation: () => m.db_problem_replikation(),
  dateien: () => m.db_problem_dateien(),
  leeren: () => m.db_problem_leeren(),
  schreiben: () => m.db_problem_schreiben(),
  vorgaben: () => m.db_problem_vorgaben(),
};

const ja = (wert: boolean) => (wert ? m.db_yes() : m.db_no());

/** Wirksame Rechte der Datenbankanmeldung (GET /api/betrieb), unter „Prüfung“ */
export function DatabaseAccess() {
  const stand = useQuery({ queryKey: ["betrieb"], queryFn: api.betrieb });
  const z = stand.data?.datenbank;
  return (
    <section aria-labelledby="datenbankzugriff" className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 id="datenbankzugriff" className="m-0 font-semibold text-base">
        {m.db_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.db_intro()}</p>
      {stand.error && <p className="m-0 text-red-700 text-sm dark:text-red-400">{stand.error.message}</p>}
      {z && (
        <>
          {z.eingeschraenkt ? (
            <p className="m-0 font-medium text-sm">{m.db_restricted({ anmeldung: z.anmeldung })}</p>
          ) : (
            <div role="alert" className="flex flex-col gap-1 text-red-700 text-sm dark:text-red-400">
              <p className="m-0 font-medium">{m.db_unrestricted({ anmeldung: z.anmeldung })}</p>
              <ul className="m-0 pl-5">
                {z.probleme.map((p) => (
                  <li key={p}>{PROBLEM[p]()}</li>
                ))}
              </ul>
              <a href={ROLLEN_DOKU} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {m.db_link()}
              </a>
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer">{m.db_rights_show()}</summary>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable) */}
            <div tabIndex={0} className="mt-2 max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr className="border-border border-b text-left text-muted">
                    <th className="px-3 py-2 font-medium">{m.db_col_table()}</th>
                    <th className="px-3 py-2 font-medium">{m.db_col_select()}</th>
                    <th className="px-3 py-2 font-medium">{m.db_col_insert()}</th>
                    <th className="px-3 py-2 font-medium">{m.db_col_update()}</th>
                    <th className="px-3 py-2 font-medium">{m.db_col_delete()}</th>
                    <th className="px-3 py-2 font-medium">{m.db_col_truncate()}</th>
                  </tr>
                </thead>
                <tbody>
                  {z.tabellen.map((t) => (
                    <tr key={t.tabelle} className="border-border border-b last:border-b-0">
                      <td className="px-3 py-1.5 font-mono text-xs">{t.tabelle}</td>
                      <td className="px-3 py-1.5">{ja(t.select)}</td>
                      <td className="px-3 py-1.5">{ja(t.insert)}</td>
                      <td className="px-3 py-1.5">{ja(t.update)}</td>
                      <td className="px-3 py-1.5">{ja(t.delete)}</td>
                      <td className="px-3 py-1.5">{ja(t.truncate || t.trigger)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
