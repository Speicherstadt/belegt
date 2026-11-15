import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const TAGE = [1, 7, 30] as const;
const DAUER: Record<(typeof TAGE)[number], () => string> = {
  1: () => m.share_link_1(),
  7: () => m.share_link_7(),
  30: () => m.share_link_30(),
};

/**
 * Teilen per Link (docs/teilen.md): Der Inhaber legt einen Link auf das Original für 1, 7 oder 30 Tage an, sieht die
 * gültigen Links mit ihren Abrufen und widerruft sie. Den Link zeigt die Seite nur direkt nach dem Anlegen.
 */
export function ShareLinks({ dokumentId }: { dokumentId: string }) {
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["links", dokumentId], queryFn: () => api.links(dokumentId) });
  const neu = () => queryClient.invalidateQueries({ queryKey: ["links", dokumentId] });
  const anlegen = useMutation({
    mutationFn: (tage: 1 | 7 | 30) => api.linkAnlegen(dokumentId, tage),
    onSuccess: neu,
  });
  const widerrufen = useMutation({
    mutationFn: (link: string) => api.linkWiderrufen(dokumentId, link),
    onSuccess: neu,
  });
  const [kopiert, setKopiert] = useState(false);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setKopiert(false);
    anlegen.mutate(Number(new FormData(e.currentTarget).get("tage")) as 1 | 7 | 30);
  }

  async function kopieren(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setKopiert(true);
    } catch {
      // Ohne Erlaubnis für die Zwischenablage bleibt das Feld zum Markieren
    }
  }

  const fehler = anlegen.error ?? widerrufen.error;
  return (
    <section aria-labelledby="teilen" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="teilen" className="m-0 font-semibold text-base">
        {m.share_link_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.share_link_intro()}</p>
      <form onSubmit={absenden} className="flex flex-wrap items-end gap-3">
        <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0 text-sm">
          <legend className="mb-1.5 p-0 font-medium">{m.share_link_valid()}</legend>
          {TAGE.map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input type="radio" name="tage" value={t} defaultChecked={t === 7} />
              {DAUER[t]()}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={anlegen.isPending}
          className="h-9 rounded-md bg-primary px-3 font-medium text-onprimary text-sm disabled:opacity-60"
        >
          {m.share_link_create()}
        </button>
      </form>
      {anlegen.data && (
        <div className="flex flex-col gap-1.5 rounded-md bg-subtle p-3 text-sm">
          <label className="flex flex-col gap-1.5 font-medium">
            {m.share_link_new()}
            <input
              readOnly
              value={anlegen.data.url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 rounded-md border border-border bg-bg px-3 font-mono font-normal text-xs"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void kopieren(anlegen.data.url)}
              className="h-8 rounded-md border border-border bg-bg px-3 font-medium hover:bg-subtle"
            >
              {m.share_link_copy()}
            </button>
            <span role="status" className="text-muted">
              {kopiert ? m.share_link_copied() : m.share_link_once()}
            </span>
          </div>
        </div>
      )}
      {liste.data && liste.data.length > 0 && (
        <ul aria-label={m.share_link_active()} className="m-0 flex list-none flex-col gap-2 p-0">
          {liste.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex flex-col">
                <span>{m.share_link_until({ datum: zeitpunkt(l.gueltigBis) })}</span>
                <span className="text-muted text-xs">
                  {l.letzterAbruf
                    ? m.share_link_fetched({ anzahl: String(l.abrufe), zeit: zeitpunkt(l.letzterAbruf) })
                    : m.share_link_not_fetched()}
                </span>
              </span>
              <button
                type="button"
                onClick={() => widerrufen.mutate(l.id)}
                disabled={widerrufen.isPending}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
              >
                {m.share_link_revoke()}
              </button>
            </li>
          ))}
        </ul>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.share_link_failed({ meldung: fehler.message })}
        </p>
      )}
    </section>
  );
}
