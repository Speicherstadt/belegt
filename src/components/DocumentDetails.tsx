import { useQuery } from "@tanstack/react-query";
import type { Ereignis } from "../lib/api.ts";
import { api } from "../lib/api.ts";
import { groesse, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { operationLabel } from "./Derivations.tsx";
import { Explain } from "./WasIstDas.tsx";

/* Dokumentseite: Angaben (Reiter „Einordnung“), Verlauf und Nachweis (Reiter „Verlauf“) */

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

/** Verlauf und Nachweis eines Dokuments (Reiter „Verlauf“) */
export function DocumentDetails({ d }: { d: Awaited<ReturnType<typeof api.dokument>> }) {
  const verlauf = useQuery({ queryKey: ["verlauf", d.id], queryFn: () => api.verlauf(d.id) });
  return (
    <>
      <section aria-labelledby="verlauf" className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 id="verlauf" className="m-0 font-semibold text-base">
          {m.doc_history()}
        </h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {verlauf.data?.ereignisse.map((e) => (
            <li key={e.seq} className="flex flex-col text-sm">
              <span className="font-medium">{ereignis(e)}</span>
              <span className="text-muted text-xs">
                {m.doc_event_meta({ wann: zeitpunkt(e.at), wer: e.akteur ?? "–", nr: String(e.seq) })}
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
          <Explain term="seal" row>
            {(knopf, satz) => (
              <>
                <dt className="flex items-center text-muted">
                  {m.doc_seal()}
                  {knopf}
                </dt>
                <dd className="m-0 break-all font-mono text-xs">{verlauf.data?.siegel ?? "–"}</dd>
                {satz}
              </>
            )}
          </Explain>
        </dl>
      </section>
    </>
  );
}

/** Angaben zum Original: ASN, Quelle, Eingang, Typ, Größe, Text (Reiter „Einordnung“, die ASN braucht man oft) */
export function DocumentFacts({ d }: { d: Awaited<ReturnType<typeof api.dokument>> }) {
  const inhalt = useQuery({ queryKey: ["inhalt", d.id], queryFn: () => api.inhalt(d.id) });
  return (
    <section aria-labelledby="angaben" className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 id="angaben" className="m-0 font-semibold text-base">
        {m.doc_details()}
      </h2>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <Explain term="asn" row>
          {(knopf, satz) => (
            <>
              <dt className="text-muted">{m.doc_asn()}</dt>
              <dd className="m-0 flex items-center">
                <span className="tabular-nums" data-testid="asn">
                  {d.asn}
                </span>
                {knopf}
              </dd>
              {satz}
            </>
          )}
        </Explain>
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
  );
}
