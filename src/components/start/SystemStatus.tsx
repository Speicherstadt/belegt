import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type ImportStatus, type Start } from "../../lib/api.ts";
import { zeitpunkt } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";

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

/** Prüfung der Hash-Kette und der letzte Zeitstempel, aus /api/pruefung */
export function ChainStatus() {
  const pruefung = useQuery({ queryKey: ["pruefung", false], queryFn: () => api.pruefung() });
  const z = pruefung.data?.bericht.zeitstempel;
  return (
    <section aria-labelledby="start-kette" className={kachel}>
      <h2 id="start-kette" className="m-0 font-semibold text-lg">
        {m.start_chain()}
      </h2>
      {pruefung.isPending && <p className="m-0 text-muted text-sm">{m.start_chain_busy()}</p>}
      {pruefung.error && <p className={fehler}>{pruefung.error.message}</p>}
      {pruefung.data && (
        <dl className="m-0 flex flex-col gap-1 text-sm">
          <dt className="text-muted">{m.start_chain_result()}</dt>
          <dd className={pruefung.data.ok ? "m-0 font-medium" : `${fehler} font-medium`}>
            {pruefung.data.ok
              ? m.start_chain_ok()
              : m.start_chain_findings({ anzahl: String(pruefung.data.befunde.length) })}
          </dd>
          <dt className="text-muted">{m.start_timestamp()}</dt>
          <dd className="m-0">
            {z ? m.start_timestamp_value({ zeit: zeitpunkt(z.zeit), dienst: z.dienst }) : m.start_timestamp_none()}
          </dd>
        </dl>
      )}
      <Link to="/pruefung" className="text-sm underline underline-offset-2">
        {m.start_chain_link()}
      </Link>
    </section>
  );
}
