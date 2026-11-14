import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Export } from "../components/Export.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

export function AuditPage() {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const [dateien, setDateien] = useState(false);
  const pruefung = useQuery({ queryKey: ["pruefung", dateien], queryFn: () => api.pruefung(dateien) });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.audit_title()} intro={m.audit_intro()} />
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button
          type="button"
          onClick={() => pruefung.refetch()}
          disabled={pruefung.isFetching}
          className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60"
        >
          {pruefung.isFetching ? m.loading() : m.audit_check()}
        </button>
        <button
          type="button"
          onClick={() => (dateien ? pruefung.refetch() : setDateien(true))}
          disabled={pruefung.isFetching}
          className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60"
        >
          {m.audit_check_files()}
        </button>
        {pruefung.data && (
          <p role="status" className="m-0 font-medium text-sm">
            {pruefung.data.ok ? m.audit_ok() : m.audit_problems({ anzahl: String(pruefung.data.befunde.length) })}
            {pruefung.data.dateienGeprueft !== undefined &&
              ` ${m.audit_files_checked({ anzahl: String(pruefung.data.dateienGeprueft) })}`}
          </p>
        )}
      </div>
      {pruefung.data && (
        <section aria-labelledby="bericht" className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="bericht" className="m-0 font-semibold text-base">
              {m.report_title()}
            </h2>
            <button
              type="button"
              onClick={() => window.print()}
              className="h-8 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle print:hidden"
            >
              {m.report_print()}
            </button>
          </div>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{m.report_time()}</dt>
            <dd className="m-0">{zeitpunkt(pruefung.data.bericht.zeitpunkt)}</dd>
            <dt className="text-muted">{m.report_result()}</dt>
            <dd className="m-0 font-medium">
              {pruefung.data.ok ? m.audit_ok() : m.audit_problems({ anzahl: String(pruefung.data.befunde.length) })}
            </dd>
            <dt className="text-muted">{m.report_checked()}</dt>
            <dd className="m-0 tabular-nums">
              {m.report_counts({
                dokumente: String(pruefung.data.bericht.dokumente),
                geloescht: String(pruefung.data.bericht.geloescht),
                siegel: String(pruefung.data.bericht.siegel),
                protokoll: String(pruefung.data.bericht.protokoll),
              })}
              {pruefung.data.dateienGeprueft !== undefined &&
                ` ${m.audit_files_checked({ anzahl: String(pruefung.data.dateienGeprueft) })}`}
            </dd>
            <dt className="text-muted">{m.report_value()}</dt>
            <dd className="m-0 break-all font-mono text-xs">{pruefung.data.bericht.pruefwert ?? "–"}</dd>
          </dl>
          <p className="m-0 text-muted text-xs">{m.report_hint()}</p>
        </section>
      )}
      {!!pruefung.data?.befunde.length && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <section aria-label={m.audit_title()} tabIndex={0} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-border border-b text-left text-muted">
                <th className="px-3 py-2.5 font-medium">{m.audit_col_kind()}</th>
                <th className="px-3 py-2.5 font-medium">{m.audit_col_table()}</th>
                <th className="px-3 py-2.5 font-medium">{m.audit_col_row()}</th>
                <th className="px-3 py-2.5 font-medium">{m.audit_col_finding()}</th>
              </tr>
            </thead>
            <tbody>
              {pruefung.data.befunde.map((b) => (
                <tr
                  key={`${b.art}-${b.tabelle}-${b.zeile}-${b.seq}`}
                  className="border-border border-b last:border-b-0"
                >
                  <td className="px-3 py-3">{b.art}</td>
                  <td className="px-3 py-3">{b.tabelle}</td>
                  <td className="px-3 py-3 font-mono text-xs">{b.zeile ?? b.seq ?? "–"}</td>
                  <td className="px-3 py-3">{b.befund}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {ich.data && (
        <div className="print:hidden">
          <Export freigabe={ich.data.zeitraum} />
        </div>
      )}
    </div>
  );
}
