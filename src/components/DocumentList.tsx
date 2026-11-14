import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { api, type Eintrag, type Gruppe } from "../lib/api.ts";
import { artLabel } from "../lib/arten.ts";
import { groesse, tag, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { EmptyState } from "./PageHeader.tsx";

const FILTER: { gruppe: Gruppe; label: () => string }[] = [
  { gruppe: "alle", label: () => m.filter_all() },
  { gruppe: "pflicht", label: () => m.filter_required() },
  { gruppe: "freiwillig", label: () => m.filter_voluntary() },
  { gruppe: "frei", label: () => m.filter_free() },
  { gruppe: "offen", label: () => m.filter_open() },
  { gruppe: "loeschbar", label: () => m.filter_deletable() },
  { gruppe: "geloescht", label: () => m.filter_deleted() },
];

function aufbewahrung(d: Eintrag): string {
  if (!d.art) return m.retention_open();
  if (!d.fristBis) return artLabel(d.art);
  return `${artLabel(d.art)}, ${m.retention_until({ datum: tag(d.fristBis) })}`;
}

/** Liste der Dokumente mit Suche, Filter nach Aufbewahrung und, für den Inhaber, Upload */
export function DocumentList({
  suchbar,
  leer,
  feste,
}: {
  suchbar: boolean;
  leer: { title: string; text: string };
  /** Feste Gruppe ohne Filter, etwa „offen“ für den Eingang */
  feste?: Gruppe;
}) {
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState<Gruppe>("alle");
  const gruppe = feste ?? gewaehlt;
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["dokumente", suche, gruppe], queryFn: () => api.dokumente(suche, gruppe) });
  const eingabe = useRef<HTMLInputElement>(null);
  const mailEingabe = useRef<HTMLInputElement>(null);
  const mailImport = useMutation({
    mutationFn: async (dateien: File[]) => {
      let neu = 0;
      let doppelt = 0;
      for (const datei of dateien) {
        const r = await api.mailsImportieren(datei);
        neu += r.neu.length;
        doppelt += r.doppelt.length;
      }
      return { neu, doppelt };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dokumente"] }),
  });
  const hochladen = useMutation({
    mutationFn: async (dateien: File[]) => {
      for (const datei of dateien) await api.hochladen(datei);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dokumente"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {suchbar && (
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <span className="sr-only">{m.archive_search()}</span>
            <input
              type="search"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={m.archive_search()}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
          </label>
        )}
        {darfSchreiben(ich.data?.role) && (
          <>
            <input
              ref={eingabe}
              type="file"
              data-testid="upload"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const dateien = [...(e.target.files ?? [])];
                e.target.value = "";
                if (dateien.length) hochladen.mutate(dateien);
              }}
            />
            <button
              type="button"
              onClick={() => eingabe.current?.click()}
              disabled={hochladen.isPending}
              className="h-10 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
            >
              {hochladen.isPending ? m.upload_busy() : m.upload()}
            </button>
            <input
              ref={mailEingabe}
              type="file"
              multiple
              accept=".eml,.mbox,.pst,.ost,message/rfc822,application/mbox"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="mail-import"
              onChange={(e) => {
                const dateien = [...(e.target.files ?? [])];
                e.target.value = "";
                if (dateien.length) mailImport.mutate(dateien);
              }}
            />
            <button
              type="button"
              onClick={() => mailEingabe.current?.click()}
              disabled={mailImport.isPending}
              className="h-10 rounded-md border border-border px-4 font-medium text-sm hover:bg-subtle disabled:opacity-60"
            >
              {mailImport.isPending ? m.import_mails_busy() : m.import_mails()}
            </button>
          </>
        )}
      </div>
      {!feste && (
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{m.archive_filter_label()}</legend>
          {FILTER.map((f) => (
            <button
              key={f.gruppe}
              type="button"
              aria-pressed={gruppe === f.gruppe}
              onClick={() => setGewaehlt(f.gruppe)}
              className="h-8 rounded-full border border-border px-3 font-medium text-sm hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
            >
              {f.label()}
            </button>
          ))}
        </fieldset>
      )}
      {mailImport.data && (
        <p role="status" className="m-0 text-sm">
          {m.import_result({ neu: String(mailImport.data.neu), doppelt: String(mailImport.data.doppelt) })}
        </p>
      )}
      {mailImport.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.upload_failed({ meldung: mailImport.error.message })}
        </p>
      )}
      {hochladen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.upload_failed({ meldung: hochladen.error.message })}
        </p>
      )}
      {liste.data?.length === 0 && <EmptyState title={leer.title} text={leer.text} />}
      {!!liste.data?.length && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <section aria-label={m.list_label()} tabIndex={0} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-border border-b text-left text-muted">
                <th className="px-3 py-2.5 font-medium">{m.col_name()}</th>
                <th className="px-3 py-2.5 font-medium">{m.col_retention()}</th>
                <th className="px-3 py-2.5 font-medium">{m.col_type()}</th>
                <th className="px-3 py-2.5 text-right font-medium">{m.col_size()}</th>
                <th className="px-3 py-2.5 text-right font-medium">{m.col_received()}</th>
              </tr>
            </thead>
            <tbody>
              {liste.data.map((d) => (
                <tr key={d.id} className="border-border border-b last:border-b-0 hover:bg-subtle">
                  <td className="px-3 py-3 font-medium">
                    <Link to="/dokumente/$id" params={{ id: d.id }} className="underline-offset-2 hover:underline">
                      {d.titel ?? d.dateiname ?? m.unnamed()}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{aufbewahrung(d)}</td>
                  <td className="px-3 py-3 text-muted">{d.mimeType}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{groesse(d.groesse)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{zeitpunkt(d.eingegangenAm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
