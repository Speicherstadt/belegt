import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
import { ProcedureSettings } from "../components/ProcedureSettings.tsx";
import { api } from "../lib/api.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Verfahrensdokumentation: erzeugt vom Server aus Code, Datenbank und den Angaben zum Betrieb; drucken ergibt das PDF */
export function ProcedurePage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const werte = useQuery({ queryKey: ["einstellungen"], queryFn: api.einstellungen });
  const doku = useQuery({ queryKey: ["verfahrensdoku"], queryFn: api.verfahrensdoku });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.procedure_title()} intro={m.procedure_intro()} />
      {doku.data && (
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
          >
            {m.procedure_print()}
          </button>
          <p role="status" className="m-0 text-sm">
            {doku.data.vollstaendig ? m.procedure_complete() : m.procedure_incomplete()}
          </p>
        </div>
      )}
      {werte.data && ich.data && <ProcedureSettings werte={werte.data} darfAendern={ich.data.role === "inhaber"} />}
      {doku.data && (
        <article lang="de" className="flex max-w-3xl flex-col gap-5 text-sm leading-relaxed">
          <p className="m-0 text-muted">{m.procedure_stand({ datum: tag(doku.data.stand) })}</p>
          {doku.data.abschnitte.map((a) => (
            <section key={a.titel} className="flex flex-col gap-2">
              <h2 className="m-0 font-semibold text-base">{a.titel}</h2>
              {a.absaetze.map((p) => (
                <p key={p} className="m-0 whitespace-pre-line">
                  {p}
                </p>
              ))}
              {!!a.liste?.length && (
                <ul className="m-0 flex flex-col gap-1 pl-5">
                  {a.liste.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              {a.luecken?.map((l) => (
                <p
                  key={l}
                  className="m-0 rounded-md border border-amber-600/40 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                >
                  {m.procedure_missing({ was: l })}
                </p>
              ))}
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
