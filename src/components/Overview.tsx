import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Zahlen zu Archiv, Eingang, Sperren und Löschbarem */
export function Overview() {
  const u = useQuery({ queryKey: ["uebersicht"], queryFn: api.uebersicht });
  if (!u.data) return null;
  const kacheln = [
    { label: m.overview_total(), wert: u.data.gesamt },
    { label: m.overview_open(), wert: u.data.offen },
    { label: m.overview_held(), wert: u.data.gesperrt },
    { label: m.overview_deletable(), wert: u.data.loeschbar, hinweis: m.overview_deletable_hint() },
  ];
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
      {kacheln.map((k) => (
        <div key={k.label} className="flex flex-col gap-1 rounded-lg border border-border p-4">
          <dt className="text-muted text-sm">{k.label}</dt>
          <dd className="m-0 font-semibold text-2xl tabular-nums">{k.wert}</dd>
          {k.hinweis && <dd className="m-0 text-muted text-xs">{k.hinweis}</dd>}
        </div>
      ))}
    </dl>
  );
}
