import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, type Dokument, type SeitenOperation, seiteUrl } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const KNOPF = "h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60";

/**
 * Seiten eines PDFs: Miniaturen, je Seite drehen und auswählen, Ausgewähltes entfernen, nach einer Seite teilen. Das
 * Original bleibt; jede Operation legt ein neues Dokument an (docs/dokument.md#seiten-bearbeiten).
 */
export function PageEditor({ dokumentId }: { dokumentId: string }) {
  const queryClient = useQueryClient();
  const seiten = useQuery({ queryKey: ["seiten", dokumentId], queryFn: () => api.seiten(dokumentId), retry: false });
  const [drehung, setDrehung] = useState<Record<number, number>>({});
  const [gewaehlt, setGewaehlt] = useState<Set<number>>(new Set());
  const [nach, setNach] = useState(1);
  const [neu, setNeu] = useState<Dokument[]>([]);
  const bearbeiten = useMutation({
    mutationFn: (op: SeitenOperation) => api.seitenBearbeiten(dokumentId, op),
    onSuccess: (r) => {
      setNeu(r.dokumente);
      setDrehung({});
      setGewaehlt(new Set());
      for (const key of [["ableitungen", dokumentId], ["verlauf", dokumentId], ["dokumente"]])
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  if (!seiten.data) return null;
  const anzahl = seiten.data.anzahl;
  const nummern = Array.from({ length: anzahl }, (_, i) => i + 1);
  const gedreht = Object.entries(drehung).filter(([, g]) => g % 360 !== 0);
  const umschalten = (nr: number) =>
    setGewaehlt((vorher) => {
      const n = new Set(vorher);
      if (!n.delete(nr)) n.add(nr);
      return n;
    });

  return (
    <section aria-labelledby="seiten" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="seiten" className="m-0 font-semibold text-base">
        {m.pages_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.pages_hint()}</p>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-0">
        {nummern.map((nr) => (
          <li key={nr} className="flex flex-col items-center gap-2 rounded-md border border-border p-2">
            <div className="flex h-44 w-full items-center justify-center overflow-hidden">
              <img
                src={seiteUrl(dokumentId, nr)}
                alt={m.pages_page({ nr: String(nr) })}
                loading="lazy"
                style={{ transform: `rotate(${drehung[nr] ?? 0}deg)` }}
                className="max-h-32 max-w-[8rem] border border-border bg-white transition-transform"
              />
            </div>
            <div className="flex w-full items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={gewaehlt.has(nr)}
                  onChange={() => umschalten(nr)}
                  className="size-4"
                  aria-label={m.pages_select({ nr: String(nr) })}
                />
                <span aria-hidden="true">{nr}</span>
              </label>
              <button
                type="button"
                onClick={() => setDrehung((d) => ({ ...d, [nr]: ((d[nr] ?? 0) + 90) % 360 }))}
                aria-label={m.pages_rotate({ nr: String(nr) })}
                className="h-8 rounded-md border border-border px-2 hover:bg-subtle"
              >
                <span aria-hidden="true">↻</span>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          disabled={!gedreht.length || bearbeiten.isPending}
          onClick={() =>
            bearbeiten.mutate({
              operation: "drehen",
              drehungen: gedreht.map(([s, g]) => ({ seite: Number(s), grad: g as 90 | 180 | 270 })),
            })
          }
          className={KNOPF}
        >
          {m.pages_save_rotation()}
        </button>
        <button
          type="button"
          disabled={!gewaehlt.size || gewaehlt.size >= anzahl || bearbeiten.isPending}
          onClick={() => bearbeiten.mutate({ operation: "entfernen", seiten: [...gewaehlt].sort((a, b) => a - b) })}
          className={KNOPF}
        >
          {m.pages_remove({ anzahl: String(gewaehlt.size) })}
        </button>
        {anzahl > 1 && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              {m.pages_split_after()}
              <select
                value={Math.min(nach, anzahl - 1)}
                onChange={(e) => setNach(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-transparent px-2"
              >
                {nummern.slice(0, -1).map((nr) => (
                  <option key={nr} value={nr}>
                    {nr}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={bearbeiten.isPending}
              onClick={() => bearbeiten.mutate({ operation: "teilen", nach: Math.min(nach, anzahl - 1) })}
              className={KNOPF}
            >
              {m.pages_split()}
            </button>
          </>
        )}
      </div>
      {bearbeiten.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {bearbeiten.error.message}
        </p>
      )}
      {neu.length > 0 && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p className="m-0">{m.pages_created()}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {neu.map((d) => (
              <li key={d.id}>
                <Link to="/dokumente/$id" params={{ id: d.id }} className="underline underline-offset-2">
                  {d.dateiname ?? m.unnamed()}
                </Link>{" "}
                <span className="text-muted">
                  ({m.col_asn()} {d.asn})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
