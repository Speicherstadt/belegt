import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { betrag, tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/** Kopfdaten einer erkannten E-Rechnung (XRechnung, ZUGFeRD); nichts, solange keine erkannt ist */
export function EInvoice({ dokumentId }: { dokumentId: string }) {
  const inhalt = useQuery({ queryKey: ["inhalt", dokumentId], queryFn: () => api.inhalt(dokumentId) });
  const r = inhalt.data?.erechnung;
  if (!r) return null;
  return (
    <section aria-labelledby="erechnung" className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 id="erechnung" className="m-0 font-semibold text-base">
        {r.typ === "381" ? m.einvoice_credit() : m.einvoice_title()}
      </h2>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">{m.einvoice_number()}</dt>
        <dd className="m-0 break-all">{r.nummer ?? "–"}</dd>
        <dt className="text-muted">{m.einvoice_date()}</dt>
        <dd className="m-0">{r.datum ? tag(r.datum) : "–"}</dd>
        <dt className="text-muted">{m.einvoice_seller()}</dt>
        <dd className="m-0">{r.verkaeufer ?? "–"}</dd>
        <dt className="text-muted">{m.einvoice_buyer()}</dt>
        <dd className="m-0">{r.kaeufer ?? "–"}</dd>
        <dt className="text-muted">{m.einvoice_total()}</dt>
        <dd className="m-0 tabular-nums">{r.bruttoCent !== null ? betrag(r.bruttoCent, r.waehrung) : "–"}</dd>
      </dl>
      <p className="m-0 text-muted text-xs">{m.einvoice_hint()}</p>
    </section>
  );
}
