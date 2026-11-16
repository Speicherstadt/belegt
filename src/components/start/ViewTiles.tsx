import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ansichtAus } from "../../../shared/archivansicht.ts";
import { api, type GespeicherteAnsicht } from "../../lib/api.ts";
import { filterParameter } from "../../lib/ordnung.ts";
import { m } from "../../paraglide/messages.js";

/** Eine Kachel aus einer gespeicherten Ansicht: Zahl der Treffer und die ersten fünf in ihrer Sortierung */
function ViewTile({ ansicht }: { ansicht: GespeicherteAnsicht }) {
  const a = ansichtAus(ansicht.parameter);
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder, enabled: !!a.feld });
  const bereit = !a.feld || !!felder.data;
  const parameter = filterParameter(a, felder.data ?? []);
  const liste = useQuery({
    queryKey: ["dokumente", a.suche, a.gruppe, parameter, 1, 5, a.sortierung],
    queryFn: () => api.dokumente(a.suche, a.gruppe, parameter, 1, 5, a.sortierung),
    enabled: bereit,
  });
  const id = `kachel-${ansicht.id}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h3 id={id} className="m-0 font-semibold text-base">
        {ansicht.name}
      </h3>
      {liste.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {liste.error.message}
        </p>
      )}
      {liste.data && (
        <>
          <p className="m-0 text-sm">
            <span className="font-semibold text-2xl tabular-nums">{liste.data.gesamt}</span>{" "}
            <span className="text-muted">{m.start_view_count({ anzahl: String(liste.data.gesamt) })}</span>
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {liste.data.eintraege.map((d) => (
              <li key={d.id} className="truncate">
                <Link to="/dokumente/$id" params={{ id: d.id }} className="underline underline-offset-2">
                  {d.titel || d.dateiname || m.start_asn({ asn: String(d.asn) })}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/archiv" search={ansicht.parameter} className="text-sm underline underline-offset-2">
        {m.start_view_open({ name: ansicht.name })}
      </Link>
    </section>
  );
}

/** Kacheln aus gespeicherten Ansichten, je Zugang selbst gewählt */
export function ViewTiles() {
  const queryClient = useQueryClient();
  const ansichten = useQuery({ queryKey: ["ansichten"], queryFn: api.ansichten });
  const kacheln = useQuery({ queryKey: ["startKacheln"], queryFn: api.startKacheln });
  const [waehlen, setWaehlen] = useState(false);
  const setzen = useMutation({
    mutationFn: api.startKachelnSetzen,
    onSuccess: (neu) => {
      queryClient.setQueryData(["startKacheln"], neu);
      setWaehlen(false);
    },
  });
  if (!ansichten.data || !kacheln.data) return null;
  const jeId = new Map(ansichten.data.map((a) => [a.id, a]));
  const gewaehlt = kacheln.data.ansichten.flatMap((id) => (jeId.has(id) ? [jeId.get(id)!] : []));

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // In der Reihenfolge der Ansichten
    setzen.mutate(ansichten.data!.filter((a) => f.get(a.id) === "on").map((a) => a.id));
  }

  return (
    <section aria-labelledby="start-ansichten" className="flex flex-col gap-3">
      <h2 id="start-ansichten" className="m-0 font-semibold text-lg">
        {m.start_views()}
      </h2>
      {!ansichten.data.length && <p className="m-0 text-muted text-sm">{m.start_views_none()}</p>}
      {gewaehlt.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
          {gewaehlt.map((a) => (
            <ViewTile key={a.id} ansicht={a} />
          ))}
        </div>
      )}
      {ansichten.data.length > 0 && !waehlen && (
        <button
          type="button"
          onClick={() => setWaehlen(true)}
          className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
        >
          {m.start_views_choose()}
        </button>
      )}
      {waehlen && (
        <form onSubmit={absenden} className="flex flex-col gap-2 text-sm">
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 font-medium">{m.start_views_choose()}</legend>
            {ansichten.data.map((a) => (
              <label key={a.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={a.id}
                  defaultChecked={kacheln.data.ansichten.includes(a.id)}
                  className="size-4"
                />
                {a.name}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={setzen.isPending}
              className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
            >
              {m.views_save_confirm()}
            </button>
            <button
              type="button"
              onClick={() => setWaehlen(false)}
              className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {m.views_cancel()}
            </button>
          </div>
          {setzen.error && (
            <p role="alert" className="m-0 text-red-700 dark:text-red-400">
              {setzen.error.message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
