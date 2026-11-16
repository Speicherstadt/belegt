import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { darfSchreiben } from "../../shared/rollen.ts";
import { Classification } from "../components/Classification.tsx";
import { Deletion } from "../components/Deletion.tsx";
import { Derivations, operationLabel } from "../components/Derivations.tsx";
import { DocumentOrdnung } from "../components/DocumentOrdnung.tsx";
import { EInvoice } from "../components/EInvoice.tsx";
import { Forwardings } from "../components/Forwardings.tsx";
import { MailSection } from "../components/MailSection.tsx";
import { Notes } from "../components/Notes.tsx";
import { OpenWith } from "../components/OpenWith.tsx";
import { PageEditor } from "../components/PageEditor.tsx";
import { EmptyState, PageHeader } from "../components/PageHeader.tsx";
import { ShareLinks } from "../components/ShareLinks.tsx";
import { Similar } from "../components/Similar.tsx";
import { ansichtUrl, api, archivfassungUrl, dateiUrl, type Ereignis } from "../lib/api.ts";
import { groesse, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const QUELLE: Record<string, () => string> = {
  upload: () => m.source_upload(),
  mail: () => m.source_mail(),
  ordner: () => m.source_ordner(),
  api: () => m.source_api(),
  abgeleitet: () => m.source_abgeleitet(),
  import: () => m.source_import(),
};

function ereignis(e: Ereignis): string {
  if (e.tabelle === "seals") return m.event_seal();
  if (e.tabelle === "einordnungen")
    return e.detail ? m.event_classified_party({ name: e.detail }) : m.event_classified();
  const name = e.detail ?? "–";
  if (e.tabelle === "dokument_tags")
    return e.aktion === "DELETE" ? m.event_tag_removed({ name }) : m.event_tag_added({ name });
  if (e.tabelle === "dokument_dokumenttypen")
    return e.aktion === "DELETE" ? m.event_doctype_removed({ name }) : m.event_doctype_set({ name });
  if (e.tabelle === "dokument_korrespondenten")
    return e.aktion === "DELETE" ? m.event_party_removed({ name }) : m.event_party_set({ name });
  if (e.tabelle === "feldwerte")
    return e.aktion === "DELETE" ? m.event_field_removed({ name }) : m.event_field_set({ name });
  if (e.tabelle === "notizen") return e.aktion === "DELETE" ? m.event_note_removed() : m.event_note_added();
  if (e.tabelle === "notiz_widerrufe") return e.aktion === "DELETE" ? m.event_note_removed() : m.event_note_withdrawn();
  if (e.tabelle === "ableitungen")
    return e.richtung === "aus"
      ? m.event_derived_from({ operation: operationLabel(e.detail) })
      : m.event_derived_into({ operation: operationLabel(e.detail) });
  if (e.aktion === "INSERT") return m.event_insert();
  return m.event_other({ aktion: e.aktion });
}

export function DocumentPage() {
  const { id } = useParams({ from: "/app/dokumente/$id" });
  const dok = useQuery({ queryKey: ["dokument", id], queryFn: () => api.dokument(id) });
  const verlauf = useQuery({ queryKey: ["verlauf", id], queryFn: () => api.verlauf(id) });
  const inhalt = useQuery({ queryKey: ["inhalt", id], queryFn: () => api.inhalt(id) });
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });

  if (dok.error) return <EmptyState title={m.doc_not_found()} text="" />;
  if (!dok.data) return <p className="text-muted text-sm">{m.loading()}</p>;
  const d = dok.data;
  const geloescht = !!d.loeschung?.bestaetigtAm;
  const einordnen = !geloescht && (
    <Classification
      key={d.einordnung?.id ?? "neu"}
      dokumentId={d.id}
      einordnung={d.einordnung}
      eingang={d.eingegangenAm}
      dokumenttyp={d.dokumenttyp}
      korrespondent={d.korrespondent}
    />
  );
  // Bei Scans die durchsuchbare Fassung: Text lässt sich darin suchen und markieren
  const vorschau = geloescht
    ? null
    : d.archivfassung
      ? "archivfassung"
      : d.mimeType === "application/pdf"
        ? "pdf"
        : d.mimeType.startsWith("image/") && d.mimeType !== "image/heic"
          ? "bild"
          : d.ansicht
            ? "ansicht"
            : null;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/archiv" className="self-start text-muted text-sm underline-offset-2 hover:underline">
        {m.doc_back()}
      </Link>
      <PageHeader title={d.einordnung?.titel ?? d.dateiname ?? m.unnamed()} intro={m.doc_unchanged()} />
      {!geloescht && (
        <div className="flex flex-wrap items-start gap-3">
          <a
            href={dateiUrl(d.id)}
            className="h-9 rounded-md border border-border px-3 py-2 font-medium text-sm hover:bg-subtle"
          >
            {m.doc_download()}
          </a>
          {d.archivfassung && (
            <a
              href={archivfassungUrl(d.id)}
              download
              className="h-9 rounded-md border border-border px-3 py-2 font-medium text-sm hover:bg-subtle"
            >
              {m.doc_download_searchable()}
            </a>
          )}
          <OpenWith dokumentId={d.id} mimeType={d.mimeType} />
        </div>
      )}
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
          {vorschau === "ansicht" && (
            <>
              <p className="m-0 mb-3 text-muted text-sm">{m.doc_derived_view()}</p>
              <iframe title={m.doc_preview()} src={ansichtUrl(d.id)} className="h-[70vh] w-full rounded bg-white" />
            </>
          )}
          {vorschau === "archivfassung" && (
            <>
              <p className="m-0 mb-3 text-muted text-sm">{m.doc_searchable_view()}</p>
              <iframe
                title={m.doc_preview()}
                src={archivfassungUrl(d.id)}
                className="h-[70vh] w-full rounded bg-white"
              />
            </>
          )}
          {!vorschau && <p className="m-0 text-muted text-sm">{m.doc_no_preview()}</p>}
        </section>
        <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-5">
          {/* Offen: Die Einordnung ist der nächste Schritt und steht zuerst */}
          {!d.einordnung && einordnen}
          <MailSection dokumentId={d.id} />
          <Derivations dokumentId={d.id} schreiben={!geloescht && darfSchreiben(ich.data?.role)} />
          <EInvoice dokumentId={d.id} />
          {(ich.data?.role === "inhaber" || ich.data?.role === "steuerberatung") && <Forwardings dokumentId={d.id} />}
          <Deletion dokumentId={d.id} einordnung={d.einordnung} loeschung={d.loeschung} />
          {!geloescht && ich.data?.role === "inhaber" && <ShareLinks dokumentId={d.id} />}
          {d.einordnung && einordnen}
          {ich.data && ich.data.role !== "pruefer" && <Notes dokumentId={d.id} ich={ich.data} geloescht={geloescht} />}
          {!geloescht && <Similar dokumentId={d.id} />}
          <DocumentOrdnung
            dokumentId={d.id}
            ordnung={{ tags: d.tags, dokumenttyp: d.dokumenttyp, korrespondent: d.korrespondent, felder: d.felder }}
            geloescht={geloescht}
          />
          <section aria-labelledby="angaben" className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <h2 id="angaben" className="m-0 font-semibold text-base">
              {m.doc_details()}
            </h2>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">{m.doc_asn()}</dt>
              <dd className="m-0 tabular-nums" data-testid="asn">
                {d.asn}
              </dd>
              <dt className="text-muted">{m.doc_source()}</dt>
              <dd className="m-0">{QUELLE[d.quelle]?.() ?? d.quelle}</dd>
              <dt className="text-muted">{m.doc_received()}</dt>
              <dd className="m-0">{zeitpunkt(d.eingegangenAm)}</dd>
              <dt className="text-muted">{m.doc_type()}</dt>
              <dd className="m-0">{d.mimeType}</dd>
              <dt className="text-muted">{m.doc_size()}</dt>
              <dd className="m-0 tabular-nums">{groesse(d.groesse)}</dd>
              {inhalt.data && (
                <>
                  <dt className="text-muted">{m.doc_text()}</dt>
                  <dd className="m-0">
                    {inhalt.data.fehler
                      ? m.doc_text_error()
                      : inhalt.data.ocr
                        ? m.doc_text_ocr({ anzahl: String(inhalt.data.textLaenge) })
                        : m.doc_text_file({ anzahl: String(inhalt.data.textLaenge) })}
                  </dd>
                </>
              )}
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
      {!geloescht && d.mimeType === "application/pdf" && darfSchreiben(ich.data?.role) && (
        <PageEditor dokumentId={d.id} />
      )}
    </div>
  );
}
