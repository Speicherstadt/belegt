import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { api, type Gruppe, type ListenFilter, PRO_SEITE } from "../lib/api.ts";
import { filterParameter, LEERER_FILTER } from "../lib/ordnung.ts";
import { m } from "../paraglide/messages.js";
import { BulkEdit } from "./BulkEdit.tsx";
import { CameraButton } from "./CameraButton.tsx";
import { type Auswahl, DocumentGrid, DocumentTable } from "./DocumentTable.tsx";
import { MergePdfs } from "./MergePdfs.tsx";
import { OrderFilter } from "./OrderFilter.tsx";
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

/** Liste der Dokumente mit Suche, Filter nach Aufbewahrung und, für den Inhaber, Upload */
export function DocumentList({
  suchbar,
  leer,
  feste,
  kamera = false,
}: {
  suchbar: boolean;
  leer: { title: string; text: string };
  /** Feste Gruppe ohne Filter, etwa „offen“ für den Eingang */
  feste?: Gruppe;
  /** Knopf „Foto aufnehmen“ (Eingang) */
  kamera?: boolean;
}) {
  const [suche, setSuche] = useState("");
  const [gewaehlt, setGewaehlt] = useState<Gruppe>("alle");
  const gruppe = feste ?? gewaehlt;
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const [filter, setFilter] = useState<ListenFilter>(LEERER_FILTER);
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder, enabled: !feste });
  const parameter = feste ? "" : filterParameter(filter, felder.data ?? []);
  // Seite ab 1; eine andere Suche, Gruppe oder ein anderer Filter beginnt wieder vorn
  const [seiteWahl, setSeiteWahl] = useState({ seite: 1, fuer: "" });
  const abfrage = JSON.stringify([suche, gruppe, parameter]);
  const seite = seiteWahl.fuer === abfrage ? seiteWahl.seite : 1;
  const abfrageDaten = useQuery({
    queryKey: ["dokumente", suche, gruppe, parameter, seite],
    queryFn: () => api.dokumente(suche, gruppe, parameter, seite),
    placeholderData: keepPreviousData,
  });
  const liste = { ...abfrageDaten, data: abfrageDaten.data?.eintraege };
  const gesamt = abfrageDaten.data?.gesamt ?? 0;
  const seiten = Math.max(1, Math.ceil(gesamt / PRO_SEITE));
  const blaettern = (neu: number) => setSeiteWahl({ seite: neu, fuer: abfrage });
  // Ist die Seite leer geworden (etwa nach dem Einordnen im Eingang), zur letzten mit Einträgen
  const leereSeite = !abfrageDaten.isPlaceholderData && liste.data?.length === 0 && seite > 1;
  useEffect(() => {
    if (leereSeite) setSeiteWahl({ seite: seiten, fuer: abfrage });
  }, [leereSeite, seiten, abfrage]);
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [sammelMeldung, setSammelMeldung] = useState<string | null>(null);
  const schreiben = darfSchreiben(ich.data?.role);
  // Gewählt ist nur, was die Liste gerade zeigt; ein anderer Filter oder eine andere Seite nimmt nichts Unsichtbares mit
  const ausgewaehlt = (liste.data ?? []).filter((d) => auswahl.has(d.id)).map((d) => d.id);
  const alleGewaehlt = !!liste.data?.length && ausgewaehlt.length === liste.data.length;
  const umschalten = (id: string) => {
    setSammelMeldung(null);
    setAuswahl((vorher) => {
      const neu = new Set(vorher);
      if (!neu.delete(id)) neu.add(id);
      return neu;
    });
  };
  const [darstellung, setDarstellung] = useState<Darstellung>(gemerkteDarstellung);
  const darstellen = (d: Darstellung) => {
    setDarstellung(d);
    try {
      localStorage.setItem(DARSTELLUNG, d);
    } catch {}
  };
  const auswahlFuerListe: Auswahl = {
    schreiben,
    gewaehlt: auswahl,
    umschalten,
    alleGewaehlt,
    alleUmschalten: () => {
      setSammelMeldung(null);
      setAuswahl(alleGewaehlt ? new Set() : new Set((liste.data ?? []).map((d) => d.id)));
    },
  };
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
        {schreiben && (
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
            {kamera && <CameraButton />}
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
      {!feste && <OrderFilter filter={filter} onChange={setFilter} />}
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
      {schreiben && ausgewaehlt.length > 0 && liste.data && (
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
          gewaehlt={liste.data.filter((d) => auswahl.has(d.id))}
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
      {liste.data?.length === 0 && seite === 1 && <EmptyState title={leer.title} text={leer.text} />}
      {!!liste.data?.length &&
        (darstellung === "kacheln" ? (
          <DocumentGrid eintraege={liste.data} auswahl={auswahlFuerListe} />
        ) : (
          <DocumentTable eintraege={liste.data} auswahl={auswahlFuerListe} />
        ))}
      {gesamt > 0 && (
        <nav aria-label={m.pages_label()} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="m-0 text-muted tabular-nums" aria-live="polite">
            {m.pages_range({
              von: String((seite - 1) * PRO_SEITE + 1),
              bis: String(Math.min(seite * PRO_SEITE, gesamt)),
              gesamt: String(gesamt),
            })}
          </p>
          {seiten > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => blaettern(seite - 1)}
                disabled={seite <= 1}
                className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
              >
                {m.pages_previous()}
              </button>
              <span className="tabular-nums">{m.pages_of({ seite: String(seite), seiten: String(seiten) })}</span>
              <button
                type="button"
                onClick={() => blaettern(seite + 1)}
                disabled={seite >= seiten}
                className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
              >
                {m.pages_next()}
              </button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
