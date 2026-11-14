import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { EmptyState, PageHeader } from "../components/PageHeader.tsx";
import { api, dateiUrl, type Ereignis } from "../lib/api.ts";
import { groesse, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const QUELLE: Record<string, () => string> = {
  upload: () => m.source_upload(),
  mail: () => m.source_mail(),
  ordner: () => m.source_ordner(),
  api: () => m.source_api(),
};

function ereignis(e: Ereignis): string {
  if (e.tabelle === "seals") return m.event_seal();
  if (e.aktion === "INSERT") return m.event_insert();
  return m.event_other({ aktion: e.aktion });
}

export function DocumentPage() {
  const { id } = useParams({ from: "/app/dokumente/$id" });
  const dok = useQuery({ queryKey: ["dokument", id], queryFn: () => api.dokument(id) });
  const verlauf = useQuery({ queryKey: ["verlauf", id], queryFn: () => api.verlauf(id) });

  if (dok.error) return <EmptyState title={m.doc_not_found()} text="" />;
  if (!dok.data) return <p className="text-muted text-sm">{m.loading()}</p>;
  const d = dok.data;
  const vorschau =
    d.mimeType === "application/pdf"
      ? "pdf"
      : d.mimeType.startsWith("image/") && d.mimeType !== "image/heic"
        ? "bild"
        : null;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/archiv" className="self-start text-muted text-sm underline-offset-2 hover:underline">
        {m.doc_back()}
      </Link>
      <PageHeader title={d.dateiname ?? m.unnamed()} intro={m.doc_unchanged()} />
      <a
        href={dateiUrl(d.id)}
        className="h-9 self-start rounded-md border border-border px-3 py-2 font-medium text-sm hover:bg-subtle"
      >
        {m.doc_download()}
      </a>
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label={m.doc_preview()}
          className="min-w-0 flex-[3_1_420px] rounded-lg border border-border bg-subtle p-4"
        >
          {vorschau === "pdf" && (
            <iframe title={m.doc_preview()} src={dateiUrl(d.id, true)} className="h-[70vh] w-full rounded bg-white" />
          )}
          {vorschau === "bild" && (
            <img src={dateiUrl(d.id, true)} alt={d.dateiname ?? m.unnamed()} className="mx-auto max-h-[70vh]" />
          )}
          {!vorschau && <p className="m-0 text-muted text-sm">{m.doc_no_preview()}</p>}
        </section>
        <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-5">
          <section aria-labelledby="angaben" className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <h2 id="angaben" className="m-0 font-semibold text-base">
              {m.doc_details()}
            </h2>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">{m.doc_source()}</dt>
              <dd className="m-0">{QUELLE[d.quelle]?.() ?? d.quelle}</dd>
              <dt className="text-muted">{m.doc_received()}</dt>
              <dd className="m-0">{zeitpunkt(d.eingegangenAm)}</dd>
              <dt className="text-muted">{m.doc_type()}</dt>
              <dd className="m-0">{d.mimeType}</dd>
              <dt className="text-muted">{m.doc_size()}</dt>
              <dd className="m-0 tabular-nums">{groesse(d.groesse)}</dd>
            </dl>
          </section>
          <section aria-labelledby="verlauf" className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <h2 id="verlauf" className="m-0 font-semibold text-base">
              {m.doc_history()}
            </h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {verlauf.data?.ereignisse.map((e) => (
                <li key={e.seq} className="flex flex-col text-sm">
                  <span className="font-medium">{ereignis(e)}</span>
                  <span className="text-muted text-xs">
                    {zeitpunkt(e.at)} · {e.akteur ?? "–"} · Nr. {e.seq}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="nachweis" className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <h2 id="nachweis" className="m-0 font-semibold text-base">
              {m.doc_proof()}
            </h2>
            <dl className="m-0 flex flex-col gap-2 text-sm">
              <dt className="text-muted">{m.doc_hash()}</dt>
              <dd className="m-0 break-all font-mono text-xs">{d.sha256}</dd>
              <dt className="text-muted">{m.doc_seal()}</dt>
              <dd className="m-0 break-all font-mono text-xs">{verlauf.data?.siegel ?? "–"}</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
