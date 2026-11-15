import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { api, type ImportLauf, type ImportStatus } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { ImportMapping } from "./ImportMapping.tsx";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";
const knopf = "h-8 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60";

const STATUS: Record<ImportStatus, () => string> = {
  wartet: () => m.paperless_status_wartet(),
  laeuft: () => m.paperless_status_laeuft(),
  fertig: () => m.paperless_status_fertig(),
  abgebrochen: () => m.paperless_status_abgebrochen(),
  fehler: () => m.paperless_status_fehler(),
};

const offen = (l: ImportLauf) => l.status === "wartet" || l.status === "laeuft";

/** Fehler eines Laufs mit Grund, erst auf Wunsch geladen */
function Fehlerliste({ lauf }: { lauf: ImportLauf }) {
  const [auf, setAuf] = useState(false);
  const fehler = useQuery({
    queryKey: ["import-fehler", lauf.id, lauf.fehler],
    queryFn: () => api.importFehler(lauf.id),
    enabled: auf,
  });
  return (
    <details onToggle={(e) => setAuf(e.currentTarget.open)} className="text-sm">
      <summary className="cursor-pointer font-medium">{m.paperless_errors()}</summary>
      <ul className="m-0 mt-1 flex list-disc flex-col gap-1 pl-5">
        {fehler.data?.map((f) => (
          <li key={f.paperlessId}>
            {m.paperless_error_item({
              id: String(f.paperlessId),
              titel: f.titel ? ` (${f.titel})` : "",
              grund: f.grund,
            })}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Ein Lauf mit Stand „x von y übernommen, z Fehler“, Hinweisen und Abbrechen */
function Lauf({ lauf, abbrechen }: { lauf: ImportLauf; abbrechen: (id: string) => void }) {
  const titel =
    lauf.art === "api"
      ? m.paperless_run_api({ quelle: lauf.quelle ?? "" })
      : m.paperless_run_export({ datei: lauf.dateiname ?? "" });
  const zahlen = { uebernommen: String(lauf.uebernommen), fehler: String(lauf.fehler) };
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {titel} · {lauf.abbrechen && offen(lauf) ? m.paperless_cancelling() : STATUS[lauf.status]()}
        </span>
        {offen(lauf) && !lauf.abbrechen && (
          <button type="button" onClick={() => abbrechen(lauf.id)} className={knopf}>
            {m.paperless_cancel()}
          </button>
        )}
      </span>
      <span role={offen(lauf) ? "status" : undefined} className="tabular-nums">
        {lauf.gesamt === null
          ? m.paperless_progress_open(zahlen)
          : m.paperless_progress({ ...zahlen, gesamt: String(lauf.gesamt) })}
        {lauf.doppelt > 0 && ` (${m.paperless_duplicates({ doppelt: String(lauf.doppelt) })})`}
      </span>
      {lauf.meldung && <span className="text-red-700 dark:text-red-400">{lauf.meldung}</span>}
      {lauf.hinweise.length > 0 && (
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-muted">
          {lauf.hinweise.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      {lauf.fehler > 0 && <Fehlerliste lauf={lauf} />}
    </li>
  );
}

/** Eine Instanz von Paperless-ngx verbinden: Name, Adresse und API-Token */
function QuelleFormular({
  anlegen,
}: {
  anlegen: (q: { name: string; url: string; token: string }, fertig: () => void) => void;
}) {
  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen(
      { name: String(f.get("name") ?? ""), url: String(f.get("url") ?? ""), token: String(f.get("token") ?? "") },
      () => form.reset(),
    );
  }
  return (
    <form
      onSubmit={absenden}
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3 rounded-lg border border-border p-3"
    >
      <label className="flex flex-col gap-1.5 font-medium text-sm">
        {m.paperless_name()}
        <input name="name" required defaultValue="Paperless-ngx" className={feld} />
      </label>
      <label className="flex flex-col gap-1.5 font-medium text-sm">
        {m.paperless_url()}
        <input name="url" type="url" required placeholder="https://paperless.example" className={feld} />
      </label>
      <label className="flex flex-col gap-1.5 font-medium text-sm">
        {m.paperless_token()}
        <input name="token" type="password" required autoComplete="off" className={feld} />
      </label>
      <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm">
        {m.paperless_create()}
      </button>
    </form>
  );
}

/** Einen Export (ZIP aus document_exporter) hochladen; der Worker importiert ihn danach */
function ExportHochladen({ hochladen, laedt }: { hochladen: (datei: File) => void; laedt: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <label className="flex flex-col gap-1.5 font-medium text-sm">
        {m.paperless_export()}
        <input
          type="file"
          accept=".zip,application/zip"
          data-testid="paperless-export"
          disabled={laedt}
          onChange={(e) => {
            const datei = e.currentTarget.files?.[0];
            if (datei) hochladen(datei);
            e.currentTarget.value = "";
          }}
          className="text-sm"
        />
      </label>
      <p className="m-0 text-muted text-xs">{laedt ? m.paperless_uploading() : m.paperless_export_hint()}</p>
    </div>
  );
}

/**
 * Umzug aus Paperless-ngx: Instanzen mit API-Token verbinden und importieren, einen Export hochladen, den Stand der
 * Läufe sehen und abbrechen, Dokumenttypen und Tags einer Art zuordnen. Nur für den Inhaber.
 */
export function PaperlessImport() {
  const id = useId();
  const queryClient = useQueryClient();
  const quellen = useQuery({ queryKey: ["paperless-quellen"], queryFn: api.paperlessQuellen });
  const laeufe = useQuery({
    queryKey: ["importe"],
    queryFn: api.importe,
    // Solange etwas läuft, alle zwei Sekunden den Stand
    refetchInterval: (q) => (q.state.data?.some(offen) ? 2000 : false),
  });
  const neu = () => queryClient.invalidateQueries({ queryKey: ["importe"] });
  const anlegen = useMutation({
    mutationFn: api.paperlessQuelleAnlegen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["paperless-quellen"] }),
  });
  const starten = useMutation({ mutationFn: api.paperlessStarten, onSuccess: neu });
  const hochladen = useMutation({ mutationFn: api.paperlessExport, onSuccess: neu });
  const abbrechen = useMutation({ mutationFn: api.importAbbrechen, onSuccess: neu });
  const fehler = anlegen.error ?? starten.error ?? hochladen.error ?? abbrechen.error;

  return (
    <section aria-labelledby={`${id}-titel`} className="flex flex-col gap-3">
      <h2 id={`${id}-titel`} className="m-0 font-semibold text-base">
        {m.paperless_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.paperless_intro()}</p>
      {quellen.data?.length === 0 && <p className="m-0 text-sm">{m.paperless_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {quellen.data?.map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
          >
            <span className="font-medium">
              {q.name} · {q.url}
            </span>
            <button
              type="button"
              onClick={() => starten.mutate(q.id)}
              disabled={laeufe.data?.some((l) => l.quelleId === q.id && offen(l))}
              className={knopf}
            >
              {m.paperless_start()}
            </button>
          </li>
        ))}
      </ul>
      <QuelleFormular anlegen={(q, fertig) => anlegen.mutate(q, { onSuccess: fertig })} />
      <ExportHochladen hochladen={(d) => hochladen.mutate(d)} laedt={hochladen.isPending} />
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.paperless_failed({ meldung: fehler.message })}
        </p>
      )}
      {!!laeufe.data?.length && (
        <>
          <h3 className="m-0 font-semibold text-sm">{m.paperless_runs()}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {laeufe.data.map((l) => (
              <Lauf key={l.id} lauf={l} abbrechen={(x) => abbrechen.mutate(x)} />
            ))}
          </ul>
        </>
      )}
      <ImportMapping />
    </section>
  );
}
