import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type ArchivAnsicht, LEERE_ANSICHT } from "../../shared/archivansicht.ts";
import { darfBearbeiten, darfSchreiben } from "../../shared/rollen.ts";
import { api, type Doppelt, type Gruppe } from "../lib/api.ts";
import { filterParameter } from "../lib/ordnung.ts";
import { m } from "../paraglide/messages.js";
import { BulkEdit } from "./BulkEdit.tsx";
import { CameraButton } from "./CameraButton.tsx";
import { type Auswahl, DocumentGrid, DocumentTable } from "./DocumentTable.tsx";
import { ListOptions } from "./ListOptions.tsx";
import { MergePdfs } from "./MergePdfs.tsx";
import { OrderFilter } from "./OrderFilter.tsx";
import { EmptyState } from "./PageHeader.tsx";
import { Pagination } from "./Pagination.tsx";
import { UploadDuplicates } from "./UploadDuplicates.tsx";
import { ZipDownload } from "./ZipDownload.tsx";

const FILTER: { gruppe: Gruppe; label: () => string }[] = [
  { gruppe: "alle", label: () => m.filter_all() },
  { gruppe: "pflicht", label: () => m.filter_required() },
  { gruppe: "freiwillig", label: () => m.filter_voluntary() },
  { gruppe: "frei", label: () => m.filter_free() },
  { gruppe: "offen", label: () => m.filter_open() },
  { gruppe: "loeschbar", label: () => m.filter_deletable() },
  { gruppe: "geloescht", label: () => m.filter_deleted() },
];
/** Nur mit eingerichtetem Prüfdienst (VALIDATOR_URL) */
const UNGUELTIG = { gruppe: "erechnung_ungueltig" as const, label: () => m.filter_einvoice_invalid() };

type Darstellung = "liste" | "kacheln";
const DARSTELLUNG = "belegt.darstellung.liste";

/** Liste oder Kacheln, je Browser gemerkt; ohne Speicher (privates Fenster) die Liste */
function gemerkteDarstellung(): Darstellung {
  try {
    return localStorage.getItem(DARSTELLUNG) === "kacheln" ? "kacheln" : "liste";
  } catch {
    return "liste";
  }
}

/**
 * Liste der Dokumente mit Suche, Filter nach Aufbewahrung und, für den Inhaber, Upload. Suche, Filter, Sortierung und
 * Darstellung stehen in ansicht; im Archiv kommt sie aus der Adresse (src/pages/ArchivePage.tsx), im Eingang ist sie
 * nur Zustand der Seite.
 */
export function DocumentList({
  suchbar,
  leer,
  feste,
  kamera = false,
  ansicht,
  setAnsicht,
}: {
  suchbar: boolean;
  leer: { title: string; text: string };
  /** Feste Gruppe ohne Filter, etwa „offen“ für den Eingang */
  feste?: Gruppe;
  /** Knopf „Foto aufnehmen“ (Eingang) */
  kamera?: boolean;
  ansicht: ArchivAnsicht;
  setAnsicht: (a: ArchivAnsicht) => void;
}) {
  const { suche, proSeite, sortierung } = ansicht;
  const gruppe = feste ?? ansicht.gruppe;
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const gruppenFilter = status.data?.erechnungPruefung || gruppe === UNGUELTIG.gruppe ? [...FILTER, UNGUELTIG] : FILTER;
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder, enabled: !feste });
  const parameter = feste ? "" : filterParameter(ansicht, felder.data ?? []);
  // Seite ab 1; eine andere Suche, Gruppe oder ein anderer Filter beginnt wieder vorn
  const [seiteWahl, setSeiteWahl] = useState({ seite: 1, fuer: "" });
  const abfrage = JSON.stringify([suche, gruppe, parameter, proSeite, sortierung]);
  const seite = seiteWahl.fuer === abfrage ? seiteWahl.seite : 1;
  const abfrageDaten = useQuery({
    queryKey: ["dokumente", suche, gruppe, parameter, seite, proSeite, sortierung],
    queryFn: () => api.dokumente(suche, gruppe, parameter, seite, proSeite, sortierung),
    placeholderData: keepPreviousData,
  });
  const liste = { ...abfrageDaten, data: abfrageDaten.data?.eintraege };
  const gesamt = abfrageDaten.data?.gesamt ?? 0;
  const seiten = Math.max(1, Math.ceil(gesamt / proSeite));
  const blaettern = (neu: number) => setSeiteWahl({ seite: neu, fuer: abfrage });
  // Ist die Seite leer geworden (etwa nach dem Einordnen im Eingang), zur letzten mit Einträgen
  const leereSeite = !abfrageDaten.isPlaceholderData && liste.data?.length === 0 && seite > 1;
  useEffect(() => {
    if (leereSeite) setSeiteWahl({ seite: seiten, fuer: abfrage });
  }, [leereSeite, seiten, abfrage]);
  // Suche oder Filter machen aus „leer“ ein „keine Treffer“ (DESIGN.md, Leerzustand); im Eingang gibt es keine
  const filterAktiv = !!suche.trim() || (!feste && (gruppe !== "alle" || parameter !== ""));
  // Zeigt der Leerzustand „Dokument hochladen“, ist der Knopf in der Leiste nur zweitrangig: genau eine Hauptaktion
  const leerMitUpload = liste.data?.length === 0 && seite === 1 && !filterAktiv;
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [sammelMeldung, setSammelMeldung] = useState<string | null>(null);
  // Mails einlesen und PDFs zusammenfügen nur der Inhaber; hochladen und sammeln auch Mitarbeiter mit bearbeiten
  const schreiben = darfSchreiben(ich.data?.role);
  const bearbeiten = darfBearbeiten(ich.data);
  // Gewählt ist nur, was die Liste gerade zeigt; ein anderer Filter oder eine andere Seite nimmt nichts Unsichtbares mit
  const gewaehlteEintraege = (liste.data ?? []).filter((d) => auswahl.has(d.id));
  const ausgewaehlt = gewaehlteEintraege.map((d) => d.id);
  const alleGewaehlt = !!liste.data?.length && ausgewaehlt.length === liste.data.length;
  const umschalten = (id: string) => {
    setSammelMeldung(null);
    setAuswahl((vorher) => {
      const neu = new Set(vorher);
      if (!neu.delete(id)) neu.add(id);
      return neu;
    });
  };
  const [gemerkt, setGemerkt] = useState<Darstellung>(gemerkteDarstellung);
  const darstellung = ansicht.darstellung ?? gemerkt;
  const darstellen = (d: Darstellung) => {
    setGemerkt(d);
    if (ansicht.darstellung) setAnsicht({ ...ansicht, darstellung: d });
    try {
      localStorage.setItem(DARSTELLUNG, d);
    } catch {}
  };
  // Wählen darf jede Rolle: herunterladen als ZIP darf jede, sammeln nur, wer bearbeitet
  const auswahlFuerListe: Auswahl = {
    waehlbar: true,
    gewaehlt: auswahl,
    umschalten,
    alleGewaehlt,
    alleUmschalten: () => {
      setSammelMeldung(null);
      setAuswahl(alleGewaehlt ? new Set() : new Set((liste.data ?? []).map((d) => d.id)));
    },
  };
  const eingabe = useRef<HTMLInputElement>(null);
  const suchEingabe = useRef<HTMLInputElement>(null);
  const uploadKnopf = useRef<HTMLButtonElement>(null);
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
    // Dateien, die schon im Archiv liegen, legt der Server nicht noch einmal an; sie stehen danach mit Link da
    mutationFn: async (dateien: File[]) => {
      const doppelt: Doppelt[] = [];
      for (const datei of dateien) {
        const r = await api.hochladen(datei);
        if (r.doppelt) doppelt.push(r.doppelt);
      }
      return doppelt;
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
              ref={suchEingabe}
              type="search"
              value={suche}
              onChange={(e) => setAnsicht({ ...ansicht, suche: e.target.value })}
              placeholder={m.archive_search()}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
          </label>
        )}
        {bearbeiten && (
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
              ref={uploadKnopf}
              type="button"
              onClick={() => eingabe.current?.click()}
              disabled={hochladen.isPending}
              className={`h-10 rounded-md px-4 font-medium text-sm disabled:opacity-60 ${leerMitUpload ? "border border-border hover:bg-subtle" : "bg-primary text-onprimary"}`}
            >
              {hochladen.isPending ? m.upload_busy() : m.upload()}
            </button>
            {kamera && <CameraButton />}
          </>
        )}
        {schreiben && (
          <>
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
        <fieldset className="m-0 flex gap-1 border-0 p-0">
          <legend className="sr-only">{m.view_label()}</legend>
          {(["liste", "kacheln"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={darstellung === d}
              onClick={() => darstellen(d)}
              className="h-10 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
            >
              {d === "liste" ? m.view_list() : m.view_grid()}
            </button>
          ))}
        </fieldset>
      </div>
      {!feste && (
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{m.archive_filter_label()}</legend>
          {gruppenFilter.map((f) => (
            <button
              key={f.gruppe}
              type="button"
              aria-pressed={gruppe === f.gruppe}
              onClick={() => setAnsicht({ ...ansicht, gruppe: f.gruppe })}
              className="h-8 rounded-full border border-border px-3 font-medium text-sm hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
            >
              {f.label()}
            </button>
          ))}
        </fieldset>
      )}
      {!feste && <OrderFilter filter={ansicht} onChange={(f) => setAnsicht({ ...ansicht, ...f })} />}
      {!feste && <ListOptions ansicht={{ ...ansicht, darstellung }} setAnsicht={setAnsicht} />}
      {liste.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.list_failed({ meldung: liste.error.message })}
        </p>
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
      {hochladen.data && <UploadDuplicates doppelt={hochladen.data} />}
      {ausgewaehlt.length > 0 && <ZipDownload gewaehlt={gewaehlteEintraege} />}
      {bearbeiten && ausgewaehlt.length > 0 && liste.data && (
        <BulkEdit
          gewaehlt={ausgewaehlt}
          eintraege={liste.data}
          fertig={(meldung) => {
            setAuswahl(new Set());
            setSammelMeldung(meldung);
          }}
        />
      )}
      {schreiben && liste.data && (
        <MergePdfs
          gewaehlt={gewaehlteEintraege}
          fertig={(meldung) => {
            setAuswahl(new Set());
            setSammelMeldung(meldung);
          }}
        />
      )}
      {sammelMeldung && (
        <p role="status" className="m-0 text-sm">
          {sammelMeldung}
        </p>
      )}
      {liste.data?.length === 0 && seite === 1 && (
        <EmptyState
          title={
            !filterAktiv
              ? leer.title
              : suche.trim()
                ? m.archive_no_match_title({ suche: suche.trim() })
                : m.archive_no_match_title_filter()
          }
          text={filterAktiv ? m.archive_no_match_text() : leer.text}
        >
          {filterAktiv ? (
            <button
              type="button"
              onClick={() => {
                // Der Knopf verschwindet mit dem Zurücksetzen; der Fokus soll nicht auf body fallen
                suchEingabe.current?.focus();
                setAnsicht({
                  ...LEERE_ANSICHT,
                  sortierung: ansicht.sortierung,
                  proSeite: ansicht.proSeite,
                  darstellung: ansicht.darstellung,
                });
              }}
              className="mt-2 h-10 rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
            >
              {m.archive_reset_filter()}
            </button>
          ) : (
            bearbeiten && (
              <button
                type="button"
                onClick={() => {
                  // Nach dem Hochladen ist der Leerzustand weg; der Fokus geht auf den bleibenden Knopf oben
                  uploadKnopf.current?.focus();
                  eingabe.current?.click();
                }}
                disabled={hochladen.isPending}
                className="mt-2 h-10 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
              >
                {m.archive_empty_upload()}
              </button>
            )
          )}
        </EmptyState>
      )}
      {!!liste.data?.length &&
        (darstellung === "kacheln" ? (
          <DocumentGrid eintraege={liste.data} auswahl={auswahlFuerListe} />
        ) : (
          <DocumentTable eintraege={liste.data} auswahl={auswahlFuerListe} />
        ))}
      <Pagination seite={seite} seiten={seiten} gesamt={gesamt} proSeite={proSeite} blaettern={blaettern} />
    </div>
  );
}
