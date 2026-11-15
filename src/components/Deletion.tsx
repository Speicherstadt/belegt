import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Einordnung, type Ich, type Loeschung } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const heute = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

/** Darf ich als zweite Person bestätigen? Nicht, wer beantragt hat; nur Inhaber und Steuerberatung */
export function kannBestaetigen(l: Loeschung, ich: Ich | undefined): boolean {
  return !!ich && (ich.role === "inhaber" || ich.role === "steuerberatung") && l.beantragtVon !== `nutzer:${ich.email}`;
}

/** Löschung auf der Dokumentseite: Nachweis, offener Antrag oder Antrag stellen */
export function Deletion({
  dokumentId,
  einordnung,
  loeschung,
}: {
  dokumentId: string;
  einordnung: Einordnung | null;
  loeschung: Loeschung | null;
}) {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const neu = () => queryClient.invalidateQueries();
  const beantragen = useMutation({ mutationFn: () => api.loeschungBeantragen(dokumentId), onSuccess: neu });
  const bestaetigen = useMutation({ mutationFn: (id: string) => api.loeschungBestaetigen(id), onSuccess: neu });
  const zurueckziehen = useMutation({ mutationFn: (id: string) => api.loeschungZurueckziehen(id), onSuccess: neu });
  const fehler = beantragen.error ?? bestaetigen.error ?? zurueckziehen.error;
  const abgelaufen =
    einordnung && (einordnung.art === "frei" || (einordnung.fristBis !== null && einordnung.fristBis < heute()));
  if (!loeschung && !abgelaufen) return null;

  return (
    <section aria-labelledby="loeschung" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="loeschung" className="m-0 font-semibold text-base">
        {m.delete_title()}
      </h2>
      {loeschung?.bestaetigtAm && (
        <p className="m-0 text-sm">
          {m.delete_done({
            wann: zeitpunkt(loeschung.bestaetigtAm),
            antrag: loeschung.beantragtVon,
            bestaetigt: loeschung.bestaetigtVon ?? "",
          })}
        </p>
      )}
      {loeschung && !loeschung.bestaetigtAm && (
        <>
          <p className="m-0 text-sm">
            {m.delete_requested({ wer: loeschung.beantragtVon, wann: zeitpunkt(loeschung.beantragtAm) })}
          </p>
          <div className="flex flex-wrap gap-2">
            {kannBestaetigen(loeschung, ich.data) && (
              <button
                type="button"
                onClick={() => bestaetigen.mutate(loeschung.id)}
                className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
              >
                {m.delete_confirm()}
              </button>
            )}
            {ich.data?.role === "inhaber" && (
              <button
                type="button"
                onClick={() => zurueckziehen.mutate(loeschung.id)}
                className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
              >
                {m.delete_withdraw()}
              </button>
            )}
          </div>
        </>
      )}
      {!loeschung && ich.data?.role === "inhaber" && (
        <>
          <p className="m-0 text-muted text-sm">
            {einordnung?.art === "frei" ? m.delete_hint_free() : m.delete_hint()}
          </p>
          <button
            type="button"
            onClick={() => beantragen.mutate()}
            className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
          >
            {m.delete_request()}
          </button>
        </>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.delete_failed({ meldung: fehler.message })}
        </p>
      )}
    </section>
  );
}
