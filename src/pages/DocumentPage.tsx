import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { Classification } from "../components/Classification.tsx";
import { Deletion } from "../components/Deletion.tsx";
import { Derivations } from "../components/Derivations.tsx";
import { DocumentDetails, DocumentFacts } from "../components/DocumentDetails.tsx";
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
import { ansichtUrl, api, archivfassungUrl, dateiUrl } from "../lib/api.ts";
import { listeLesen, nachbarn } from "../lib/blaettern.ts";
import { m } from "../paraglide/messages.js";

const REITER = ["einordnung", "notizen", "weiteres", "verlauf"] as const;
type Reiter = (typeof REITER)[number];
const REITER_LABEL: Record<Reiter, () => string> = {
  einordnung: () => m.doc_tab_classification(),
  notizen: () => m.doc_tab_notes(),
  weiteres: () => m.doc_tab_more(),
  verlauf: () => m.doc_tab_history(),
};

/** Tasten zum Blättern gelten nicht, solange jemand tippt */
const tipptGerade = (e: KeyboardEvent) =>
  e.altKey ||
  e.ctrlKey ||
  e.metaKey ||
  (e.target instanceof HTMLElement && !!e.target.closest("input, textarea, select, [contenteditable]"));

const knopf = "flex h-9 items-center rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle";

/**
 * Ein Dokument: links die Vorschau, groß und beim Scrollen stehend; rechts Reiter für Einordnung, Notizen, Weiteres und
 * Verlauf. Der Reiter steht in der Adresse. Kommt man aus einer Liste, blättern ← und → (auch als Tasten) darin
 */
export function DocumentPage() {
  const { id } = useParams({ from: "/app/dokumente/$id" });
  const search = useSearch({ strict: false }) as { reiter?: string };
  const navigate = useNavigate();
  const router = useRouter();
  const reiter: Reiter = REITER.includes(search.reiter as Reiter) ? (search.reiter as Reiter) : "einordnung";
  const dok = useQuery({ queryKey: ["dokument", id], queryFn: () => api.dokument(id) });
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = listeLesen();
  const { vorher, weiter, stelle, anzahl } = nachbarn(liste, id);
  // Zurück in die Liste, aus der man kam; sonst ins Archiv
  const zurueck = anzahl && liste ? liste.zurueck : "/archiv";
  const oeffnen = (ziel: string) =>
    void navigate({ to: "/dokumente/$id", params: { id: ziel }, search: reiter === "einordnung" ? {} : { reiter } });

  useEffect(() => {
    function taste(e: KeyboardEvent) {
      if (tipptGerade(e)) return;
      const ziel = e.key === "ArrowLeft" ? vorher : e.key === "ArrowRight" ? weiter : null;
      if (!ziel) return;
      e.preventDefault();
      void navigate({ to: "/dokumente/$id", params: { id: ziel }, search: reiter === "einordnung" ? {} : { reiter } });
    }
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [vorher, weiter, reiter, navigate]);

  if (dok.error) return <EmptyState title={m.doc_not_found()} text="" />;
  if (!dok.data) return <p className="text-muted text-sm">{m.loading()}</p>;
  const d = dok.data;
  const geloescht = !!d.loeschung?.bestaetigtAm;
  const offen = !d.einordnung;
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
  const rahmen = "h-[calc(100vh-14rem)] min-h-96 w-full rounded bg-white";

  const inhalt: Record<Reiter, ReactNode> = {
    einordnung: (
      <>
        {!geloescht && (
          <Classification
            key={d.einordnung?.id ?? "neu"}
            dokumentId={d.id}
            einordnung={d.einordnung}
            eingang={d.eingegangenAm}
            dokumenttyp={d.dokumenttyp}
            korrespondent={d.korrespondent}
            weiter={offen && weiter ? () => oeffnen(weiter) : undefined}
          />
        )}
        <DocumentOrdnung
          dokumentId={d.id}
          ordnung={{ tags: d.tags, dokumenttyp: d.dokumenttyp, korrespondent: d.korrespondent, felder: d.felder }}
          geloescht={geloescht}
        />
        <MailSection dokumentId={d.id} />
        <EInvoice dokumentId={d.id} />
        <DocumentFacts d={d} />
      </>
    ),
    notizen: ich.data && ich.data.role !== "pruefer" && (
      <Notes dokumentId={d.id} ich={ich.data} geloescht={geloescht} />
    ),
    weiteres: (
      <>
        {!geloescht && ich.data?.role === "inhaber" && <ShareLinks key={d.id} dokumentId={d.id} />}
        {(ich.data?.role === "inhaber" || ich.data?.role === "steuerberatung") && <Forwardings dokumentId={d.id} />}
        <Derivations dokumentId={d.id} schreiben={!geloescht && darfSchreiben(ich.data?.role)} />
        {!geloescht && <Similar dokumentId={d.id} />}
        <Deletion dokumentId={d.id} einordnung={d.einordnung} vormalsAnders={d.vormalsAnders} loeschung={d.loeschung} />
      </>
    ),
    verlauf: <DocumentDetails d={d} />,
  };
  const reiterSichtbar = REITER.filter((r) => r !== "notizen" || (ich.data && ich.data.role !== "pruefer"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a
          href={zurueck}
          onClick={(e) => {
            e.preventDefault();
            router.history.push(zurueck);
          }}
          className="text-muted text-sm underline-offset-2 hover:underline"
        >
          {m.doc_back()}
        </a>
        {anzahl > 1 && (
          <nav aria-label={m.doc_nav_label()} className="flex items-center gap-2 text-sm">
            <button
              type="button"
              disabled={!vorher}
              onClick={() => vorher && oeffnen(vorher)}
              aria-label={m.doc_nav_prev()}
              title={m.doc_nav_prev()}
              className={`${knopf} disabled:opacity-40`}
            >
              ←
            </button>
            <span className="text-muted tabular-nums">
              {m.doc_nav_position({ stelle: String(stelle), anzahl: String(anzahl) })}
            </span>
            <button
              type="button"
              disabled={!weiter}
              onClick={() => weiter && oeffnen(weiter)}
              aria-label={m.doc_nav_next()}
              title={m.doc_nav_next()}
              className={`${knopf} disabled:opacity-40`}
            >
              →
            </button>
          </nav>
        )}
      </div>
      <PageHeader title={d.einordnung?.titel ?? d.dateiname ?? m.unnamed()} intro={m.doc_unchanged()} />
      {!geloescht && (
        <div className="flex flex-wrap items-start gap-3">
          <a href={dateiUrl(d.id)} className={knopf}>
            {m.doc_download()}
          </a>
          {d.archivfassung && (
            <a href={archivfassungUrl(d.id)} download className={knopf}>
              {m.doc_download_searchable()}
            </a>
          )}
          <OpenWith dokumentId={d.id} mimeType={d.mimeType} />
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <section
          aria-label={m.doc_preview()}
          className="min-w-0 rounded-lg border border-border bg-subtle p-3 lg:sticky lg:top-4"
        >
          {vorschau === "pdf" && <iframe title={m.doc_preview()} src={dateiUrl(d.id, true)} className={rahmen} />}
          {vorschau === "bild" && (
            <img
              src={dateiUrl(d.id, true)}
              alt={d.dateiname ?? m.unnamed()}
              className="mx-auto max-h-[calc(100vh-14rem)]"
            />
          )}
          {vorschau === "ansicht" && (
            <>
              <p className="m-0 mb-3 text-muted text-sm">{m.doc_derived_view()}</p>
              <iframe title={m.doc_preview()} src={ansichtUrl(d.id)} className={rahmen} />
            </>
          )}
          {vorschau === "archivfassung" && (
            <>
              <p className="m-0 mb-3 text-muted text-sm">{m.doc_searchable_view()}</p>
              <iframe title={m.doc_preview()} src={archivfassungUrl(d.id)} className={rahmen} />
            </>
          )}
          {!vorschau && <p className="m-0 text-muted text-sm">{m.doc_no_preview()}</p>}
        </section>
        <div className="flex min-w-0 flex-col gap-4">
          <div role="tablist" aria-label={m.doc_tabs_label()} className="flex gap-1 border-border border-b">
            {reiterSichtbar.map((r) => (
              <Link
                key={r}
                role="tab"
                aria-selected={reiter === r}
                to="/dokumente/$id"
                params={{ id: d.id }}
                search={r === "einordnung" ? {} : { reiter: r }}
                replace
                className="-mb-px border-transparent border-b-2 px-3 py-2 font-medium text-muted text-sm hover:text-fg aria-selected:border-fg aria-selected:text-fg"
              >
                {REITER_LABEL[r]()}
              </Link>
            ))}
          </div>
          <div role="tabpanel" aria-label={REITER_LABEL[reiter]()} className="flex flex-col gap-5">
            {inhalt[reiter]}
          </div>
        </div>
      </div>
      {!geloescht && d.mimeType === "application/pdf" && darfSchreiben(ich.data?.role) && (
        <PageEditor dokumentId={d.id} />
      )}
    </div>
  );
}
