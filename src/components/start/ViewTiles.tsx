import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useAnsichtTreffer } from "../../lib/ansichtTreffer.ts";
import { api, type GespeicherteAnsicht } from "../../lib/api.ts";
import { tag } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";
import { TagChip } from "../TagChip.tsx";
import { Thumbnail } from "../Thumbnail.tsx";

/**
 * Eine gespeicherte Ansicht auf der Startseite: Name und Zahl der Treffer, darunter die ersten fünf Dokumente mit
 * Vorschaubild, Korrespondent, Eingang und Tags, unten der Weg ins Archiv
 */
function ViewTile({ ansicht }: { ansicht: GespeicherteAnsicht }) {
  const liste = useAnsichtTreffer(ansicht);
  const id = `kachel-${ansicht.id}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={id} className="m-0 font-semibold text-base">
          {ansicht.name}
        </h3>
        {liste.data && (
          <span className="text-muted text-sm">
            <span className="font-semibold text-fg tabular-nums">{liste.data.gesamt}</span>{" "}
            {m.start_view_count({ anzahl: String(liste.data.gesamt) })}
          </span>
        )}
      </div>
      {liste.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {liste.error.message}
        </p>
      )}
      {liste.data && (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0 text-sm">
          {liste.data.eintraege.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <div className="w-10 shrink-0">
                <Thumbnail dokument={d} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  to="/dokumente/$id"
                  params={{ id: d.id }}
                  className="truncate font-medium underline-offset-2 hover:underline"
                >
                  {d.titel || d.dateiname || m.start_asn({ asn: String(d.asn) })}
                </Link>
                <span className="truncate text-muted text-xs">
                  {d.korrespondent ? `${d.korrespondent.name} · ` : ""}
                  {tag(d.eingegangenAm)}
                </span>
              </div>
              <span className="hidden max-w-[40%] flex-wrap justify-end gap-1 sm:flex">
                {d.tags.slice(0, 2).map((t) => (
                  <TagChip key={t.id} tag={t} />
                ))}
              </span>
            </li>
          ))}
        </ul>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3">
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
