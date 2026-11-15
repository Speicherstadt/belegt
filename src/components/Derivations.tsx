import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type Ableitungsart, api, type Verknuepfung } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

export function operationLabel(op: string | null): string {
  const labels: Record<Ableitungsart, () => string> = {
    drehen: () => m.derived_op_rotate(),
    entfernen: () => m.derived_op_remove(),
    teilen: () => m.derived_op_split(),
    zusammenfuegen: () => m.derived_op_merge(),
  };
  return labels[op as Ableitungsart]?.() ?? op ?? "–";
}

function Eintraege({ titel, liste }: { titel: string; liste: Verknuepfung[] }) {
  if (!liste.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 font-medium text-sm">{titel}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.map((v) => (
          <li key={`${v.dokumentId}-${v.position}`} className="flex flex-col text-sm">
            <span>
              <Link to="/dokumente/$id" params={{ id: v.dokumentId }} className="underline underline-offset-2">
                {v.titel ?? v.dateiname ?? m.unnamed()}
              </Link>{" "}
              <span className="text-muted">
                ({m.col_asn()} {v.asn}){v.geloescht ? `, ${m.derived_deleted()}` : ""}
              </span>
            </span>
            <span className="text-muted text-xs">
              {operationLabel(v.operation)} · {zeitpunkt(v.erstelltAm)} · {v.akteur}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Woraus ein Dokument abgeleitet ist und was daraus abgeleitet wurde. Ein abgeleitetes Dokument übernimmt Tags,
 * Dokumenttyp und Felder seiner (ersten) Quelle nicht von selbst; „Ordnung übernehmen“ setzt sie auf Wunsch.
 */
export function Derivations({ dokumentId, schreiben }: { dokumentId: string; schreiben: boolean }) {
  const queryClient = useQueryClient();
  const ableitungen = useQuery({ queryKey: ["ableitungen", dokumentId], queryFn: () => api.ableitungen(dokumentId) });
  const uebernehmen = useMutation({
    mutationFn: async (quelle: string) => {
      const q = await api.dokument(quelle);
      if (!q.tags.length && !q.dokumenttyp && !q.felder.length) return false;
      await api.ordnen(dokumentId, {
        tagsHinzu: q.tags.map((t) => t.id),
        ...(q.dokumenttyp ? { dokumenttyp: q.dokumenttyp.id } : {}),
        felder: q.felder.map((f) => ({ feldId: f.feldId, wert: f.wert })),
      });
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dokument", dokumentId] });
      void queryClient.invalidateQueries({ queryKey: ["verlauf", dokumentId] });
    },
  });
  const d = ableitungen.data;
  if (!d || (!d.aus.length && !d.daraus.length)) return null;
  const quelle = d.aus[0];

  return (
    <section aria-labelledby="ableitungen" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="ableitungen" className="m-0 font-semibold text-base">
        {m.derived_title()}
      </h2>
      <Eintraege titel={m.derived_from()} liste={d.aus} />
      <Eintraege titel={m.derived_into()} liste={d.daraus} />
      {schreiben && quelle && !quelle.geloescht && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-muted text-sm">{m.derived_order_hint()}</p>
          <button
            type="button"
            onClick={() => uebernehmen.mutate(quelle.dokumentId)}
            disabled={uebernehmen.isPending}
            className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60"
          >
            {m.derived_order_apply()}
          </button>
          {uebernehmen.data !== undefined && (
            <p role="status" className="m-0 text-sm">
              {uebernehmen.data ? m.derived_order_done() : m.derived_order_none()}
            </p>
          )}
          {uebernehmen.error && (
            <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
              {uebernehmen.error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
