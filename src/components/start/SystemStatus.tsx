import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ImportStatus, type Start } from "../../lib/api.ts";
import { zeitpunkt } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";
import { SealBadge, VERALTET_STUNDEN } from "../SealBadge.tsx";

const STATUS: Record<ImportStatus, () => string> = {
  wartet: () => m.paperless_status_wartet(),
  laeuft: () => m.paperless_status_laeuft(),
  fertig: () => m.paperless_status_fertig(),
  abgebrochen: () => m.paperless_status_abgebrochen(),
  fehler: () => m.paperless_status_fehler(),
};

const kachel = "flex flex-col gap-2 rounded-lg border border-border p-4";
const fehler = "m-0 text-red-700 text-sm dark:text-red-400";

/** Zustand der Quellen: Postfächer mit letztem Abruf oder Fehler, Eingangsordner, letzter Lauf aus Paperless-ngx */
export function SourceStatus({ quellen }: { quellen: NonNullable<Start["quellen"]> }) {
  const leer = !quellen.postfaecher.length && !quellen.ordner && !quellen.paperless;
  return (
    <section aria-labelledby="start-quellen" className={kachel}>
      <h2 id="start-quellen" className="m-0 font-semibold text-lg">
        {m.start_sources()}
      </h2>
      {leer && <p className="m-0 text-muted text-sm">{m.start_sources_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
        {quellen.postfaecher.map((p) => (
          <li key={p.id} className="flex flex-col">
            <span className="font-medium">{p.name}</span>
            {!p.aktiv ? (
              <span className="text-muted">{m.start_source_inactive()}</span>
            ) : p.letzterFehler ? (
              <span className={fehler}>{m.start_source_error({ meldung: p.letzterFehler })}</span>
            ) : (
              <span className="text-muted">
                {p.letzterAbruf ? m.start_source_fetched({ zeit: zeitpunkt(p.letzterAbruf) }) : m.start_source_never()}
              </span>
            )}
          </li>
        ))}
        {quellen.ordner && (
          <li className="flex flex-col">
            <span className="font-medium">{m.start_folder()}</span>
            <span className="text-muted">
              {quellen.ordner.letzterEingang
                ? m.start_folder_last({ zeit: zeitpunkt(quellen.ordner.letzterEingang) })
                : m.start_folder_never()}
            </span>
          </li>
        )}
        {quellen.paperless && (
          <li className="flex flex-col">
            <span className="font-medium">{m.start_paperless()}</span>
            <span className={quellen.paperless.status === "fehler" ? fehler : "text-muted"}>
              {m.start_paperless_run({
                status: STATUS[quellen.paperless.status as ImportStatus]?.() ?? quellen.paperless.status,
                uebernommen: String(quellen.paperless.uebernommen),
                fehler: String(quellen.paperless.fehler),
                zeit: zeitpunkt(quellen.paperless.zeitpunkt),
              })}
            </span>
          </li>
        )}
      </ul>
      <Link to="/quellen" className="text-sm underline underline-offset-2">
        {m.start_sources_link()}
      </Link>
    </section>
  );
}

/**
 * Der letzte gespeicherte Lauf der Prüfung von Hash-Kette, Kopf und Siegeln und der letzte Zeitstempel, aus /api/kette;
 * die Prüfung selbst läuft im Worker, auf Wunsch des Inhabers sofort
 */
export function ChainStatus({ inhaber }: { inhaber: boolean }) {
  const queryClient = useQueryClient();
  const kette = useQuery({ queryKey: ["kette"], queryFn: api.kette });
  const jetzt = useMutation({
    mutationFn: api.ketteJetztPruefen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kette"] }),
  });
  const lauf = kette.data?.lauf;
  const z = kette.data?.zeitstempel;
  const veraltet = !!lauf && Date.now() - new Date(lauf.geprueftAm).getTime() > VERALTET_STUNDEN * 3_600_000;
  return (
    <section aria-labelledby="start-kette" className={kachel}>
      <h2 id="start-kette" className="m-0 font-semibold text-lg">
        {m.start_chain()}
      </h2>
      {kette.error && <p className={fehler}>{kette.error.message}</p>}
      <SealBadge gross />
      {kette.data && (
        <dl className="m-0 flex flex-col gap-1 text-sm">
          {lauf && (
            <>
              <dt className="text-muted">{m.start_chain_checked()}</dt>
              <dd className={veraltet ? `${fehler} m-0` : "m-0"}>
                {m.start_chain_checked_value({ zeit: zeitpunkt(lauf.geprueftAm), eintraege: String(lauf.eintraege) })}
                {veraltet && ` ${m.start_chain_stale()}`}
              </dd>
            </>
          )}
          <dt className="text-muted">{m.start_timestamp()}</dt>
          <dd className="m-0">
            {z ? m.start_timestamp_value({ zeit: zeitpunkt(z.zeit), dienst: z.dienst }) : m.start_timestamp_none()}
          </dd>
        </dl>
      )}
      {inhaber && (
        <button
          type="button"
          onClick={() => jetzt.mutate()}
          disabled={jetzt.isPending}
          className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle disabled:opacity-60"
        >
          {jetzt.isPending ? m.start_chain_busy() : m.start_chain_now()}
        </button>
      )}
      {jetzt.error && <p className={fehler}>{jetzt.error.message}</p>}
      <Link to="/pruefung" className="text-sm underline underline-offset-2">
        {m.start_chain_link()}
      </Link>
    </section>
  );
}
