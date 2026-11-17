import { alsMarkdown } from "@firsttris/gobd-kern/verfahrensdoku";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
import { ProcedureSettings } from "../components/ProcedureSettings.tsx";
import { api, type Verfahrensdoku } from "../lib/api.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/**
 * Verfahrensdokumentation: erzeugt vom Server aus Code, Datenbank und den Angaben zum Betrieb; drucken ergibt das PDF,
 * „Als Markdown“ dieselbe Fassung als Text (alsMarkdown aus dem GoBD-Kern, im Browser aus der Antwort des Servers)
 */

function markdownSichern(doku: Verfahrensdoku) {
  const url = URL.createObjectURL(new Blob([alsMarkdown(doku)], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `verfahrensdokumentation-${doku.stand.datum}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Schlüssel für Zeilen, die gleich lauten können: Zwei Postfächer mit demselben Namen, Benutzer und Server ergeben
 * dieselbe Zeile; die zweite bekommt einen Zähler, sonst verwechselte React die beiden.
 */
function mitSchluessel(zeilen: string[]): { schluessel: string; text: string }[] {
  const gesehen = new Map<string, number>();
  return zeilen.map((text) => {
    const n = (gesehen.get(text) ?? 0) + 1;
    gesehen.set(text, n);
    return { schluessel: n === 1 ? text : `${text}#${n}`, text };
  });
}

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
          <button
            type="button"
            onClick={() => markdownSichern(doku.data)}
            className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
          >
            {m.procedure_markdown()}
          </button>
          <p role="status" className="m-0 text-sm">
            {doku.data.vollstaendig ? m.procedure_complete() : m.procedure_incomplete()}
          </p>
        </div>
      )}
      {werte.data && ich.data && <ProcedureSettings werte={werte.data} darfAendern={ich.data.role === "inhaber"} />}
      {doku.data && (
        <article lang="de" className="flex max-w-3xl flex-col gap-5 text-sm leading-relaxed [overflow-wrap:anywhere]">
          <p className="m-0 text-muted">
            {m.procedure_stand({
              datum: tag(doku.data.stand.datum),
              programm: doku.data.stand.programm,
              version: doku.data.stand.version,
            })}
          </p>
          {doku.data.abschnitte.map((a) => (
            <section key={a.titel} className="flex flex-col gap-2">
              <h2 className="m-0 font-semibold text-base">{a.titel}</h2>
              {mitSchluessel(a.absaetze).map(({ schluessel, text }) => (
                <p key={schluessel} className="m-0 whitespace-pre-line">
                  {text}
                </p>
              ))}
              {!!a.liste?.length && (
                <ul className="m-0 flex flex-col gap-1 pl-5">
                  {mitSchluessel(a.liste).map(({ schluessel, text }) => (
                    <li key={schluessel}>{text}</li>
                  ))}
                </ul>
              )}
              {mitSchluessel(a.luecken ?? []).map(({ schluessel, text: l }) => (
                <p
                  key={schluessel}
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
