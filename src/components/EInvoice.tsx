import { useQuery } from "@tanstack/react-query";
import { api, type ERechnungsPruefung } from "../lib/api.ts";
import { betrag, tag, zeitpunkt } from "../lib/format.ts";
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
      {inhalt.data?.pruefung && <Check pruefung={inhalt.data.pruefung} />}
    </section>
  );
}

/** Ergebnis des KoSIT-Validators: gültig oder ungültig, Szenario und die ersten Fehler und Warnungen */
function Check({ pruefung: p }: { pruefung: ERechnungsPruefung }) {
  return (
    <div className="flex flex-col gap-1.5 border-border border-t pt-2 text-sm">
      <h3 className="m-0 font-medium text-sm">{m.einvoice_check_title()}</h3>
      <p className={`m-0 font-medium ${p.gueltig ? "" : "text-red-700 dark:text-red-400"}`}>
        {p.gueltig ? m.einvoice_check_valid() : m.einvoice_check_invalid({ anzahl: String(p.fehler) })}
        {p.warnungen > 0 && ` · ${m.einvoice_check_warnings({ anzahl: String(p.warnungen) })}`}
      </p>
      <p className="m-0 break-words text-muted text-xs">
        {p.szenario ?? m.einvoice_check_no_scenario()} · {zeitpunkt(p.geprueftAm)}
      </p>
      {p.meldungen.length > 0 && (
        <ul aria-label={m.einvoice_check_messages()} className="m-0 flex flex-col gap-1 pl-4 text-xs">
          {p.meldungen.map((x, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Meldungen können sich wiederholen, die Liste ändert sich nicht
            <li key={i} className="break-words">
              <span className="font-medium">
                {x.stufe === "fehler" ? m.einvoice_check_error() : m.einvoice_check_warning()}
                {x.code ? ` ${x.code}` : ""}:
              </span>{" "}
              {x.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
