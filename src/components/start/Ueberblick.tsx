import { Link } from "@tanstack/react-router";
import { Trash2, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import type { Start } from "../../lib/api.ts";
import { groesse } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";
import { InKopfzeile } from "../Kopfzeile.tsx";
import { BereichSymbol } from "../Symbole.tsx";
import { Belegung, Ring, Verlauf } from "./Diagramme.tsx";

/*
 * Kennzahlen der Startseite als Reihe gleich gebauter Kacheln (DESIGN.md, Startseite): Beschriftung, Wert (mit
 * Veränderung), ein kleines Diagramm, eine Zeile darunter. Die vier Zeilen liegen in einem Subgrid, damit sie über alle
 * Kacheln auf einer Linie stehen. Jede Kachel ist eine Gruppe aus dt und dd; die Diagramme sagen nichts, was nicht
 * auch als Text dasteht.
 */

const kachel = "row-span-4 grid grid-rows-subgrid gap-2 rounded-xl border border-border bg-bg p-4";
const wert = "m-0 font-semibold text-3xl leading-none tracking-tight";
const zeile = "m-0 self-end text-muted text-xs";

function Beschriftung({ bereich, symbol, children }: { bereich?: string; symbol?: ReactNode; children: ReactNode }) {
  return (
    <dt className="flex min-w-0 items-center justify-between gap-2 font-medium text-muted text-xs">
      <span className="truncate">{children}</span>
      {bereich ? <BereichSymbol bereich={bereich} className="size-4" /> : symbol}
    </dt>
  );
}

function Weiter({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="hover:text-fg hover:underline">
      {children} →
    </Link>
  );
}

/** Die letzten zwölf Monate kurz in der Sprache der Oberfläche, der laufende zuletzt */
function monate(anzahl: number) {
  const format = new Intl.DateTimeFormat(getLocale(), { month: "short", year: "numeric" });
  const jetzt = new Date();
  return Array.from({ length: anzahl }, (_, i) =>
    format.format(new Date(jetzt.getFullYear(), jetzt.getMonth() - (anzahl - 1 - i), 1)),
  );
}

function Archiv({ start }: { start: Start }) {
  const trend = start.vorjahr > 0 ? Math.round(((start.diesesJahr - start.vorjahr) / start.vorjahr) * 100) : null;
  const Pfeil = trend !== null && trend < 0 ? TrendingDown : TrendingUp;
  return (
    <div className={kachel}>
      <Beschriftung bereich="/archiv">{m.start_total()}</Beschriftung>
      <dd className="m-0 flex items-baseline gap-2">
        <span className={wert}>{start.gesamt}</span>
        {trend !== null && (
          <span className="inline-flex items-center gap-0.5 font-medium text-muted text-xs">
            <Pfeil aria-hidden="true" className="size-3.5" />
            {m.start_trend({ prozent: `${trend > 0 ? "+" : ""}${trend} %` })}
          </span>
        )}
      </dd>
      <dd className="m-0 self-end">
        <Verlauf werte={start.verlauf} monate={monate(start.verlauf.length)} label={m.start_chart_label()} />
      </dd>
      <dd className={zeile}>{m.start_this_year_short({ anzahl: String(start.diesesJahr) })}</dd>
    </div>
  );
}

function Eingang({ start }: { start: Start }) {
  const fertig = start.gesamt - start.eingang;
  return (
    <div className={kachel}>
      <Beschriftung bereich="/eingang">{m.start_inbox()}</Beschriftung>
      <dd className={wert}>{start.eingang}</dd>
      <dd className="m-0 flex h-8 items-center gap-2.5 self-end">
        <Ring anteil={start.gesamt ? fertig / start.gesamt : 1} />
        <span className="flex flex-col text-xs leading-tight">
          <span className="font-medium">{start.gesamt ? Math.round((fertig / start.gesamt) * 100) : 100} %</span>
          <span className="text-muted">{m.start_sorted({ fertig: String(fertig), gesamt: String(start.gesamt) })}</span>
        </span>
      </dd>
      <dd className={zeile}>
        <Weiter to="/eingang">{m.start_inbox_link()}</Weiter>
      </dd>
    </div>
  );
}

function Speicher({ speicher }: { speicher: NonNullable<Start["speicher"]> }) {
  const d = speicher.datentraeger;
  return (
    <div className={kachel}>
      <Beschriftung bereich="#speicher">{m.start_storage()}</Beschriftung>
      <dd className={wert}>{groesse(speicher.bytes)}</dd>
      <dd className="m-0 self-end">
        {d && <Belegung originale={speicher.bytes / d.gesamt} belegt={(d.gesamt - d.frei) / d.gesamt} />}
      </dd>
      <dd className={`${zeile} flex flex-wrap items-center gap-x-2`}>
        {d ? (
          <>
            {/* Schwarz die Originale, grau der übrige belegte Platz, frei nur der Rand; eine Zeile wie in den anderen
                Kacheln */}
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-[2px] bg-fg" />
              {m.start_legend_originals()}
            </span>
            <span aria-hidden="true">·</span>
            <span>{`${m.start_disk_free({ frei: groesse(d.frei) })} ${m.start_disk_of({ gesamt: groesse(d.gesamt) })}`}</span>
          </>
        ) : (
          m.start_storage_hint({ anzahl: String(speicher.dateien) })
        )}
      </dd>
    </div>
  );
}

function Pflege({ start }: { start: Start }) {
  const antraege = start.loeschantraege ?? 0;
  const paar = "flex items-center justify-between gap-2";
  return (
    <div className={kachel}>
      <Beschriftung symbol={<Trash2 aria-hidden="true" className="size-4" />}>
        {m.start_deletion_requests()}
      </Beschriftung>
      <dd className="m-0 flex items-center gap-2">
        <span className={wert}>{antraege}</span>
        {antraege > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-warn text-xs">
            <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
            {m.start_care_waiting()}
          </span>
        )}
      </dd>
      <dd className="m-0 self-end">
        <dl className="m-0 flex flex-col gap-1 text-xs">
          {start.sperren && (
            <div className={paar}>
              <dt className="text-muted">{m.start_holds()}</dt>
              <dd className="m-0 font-medium">{start.sperren.aktiv}</dd>
            </div>
          )}
        </dl>
      </dd>
      <dd className={zeile}>
        <Weiter to="/fristen">{m.start_retention_link()}</Weiter>
      </dd>
    </div>
  );
}

/** Kennzahlen der Startseite; Speicher und Löschanträge nur, wenn der Server sie für die Rolle liefert */
export function Ueberblick({ start }: { start: Start }) {
  return (
    <section aria-labelledby="start-zahlen" className="flex flex-col gap-3">
      {/* Die Überschrift steht oben in der Kopfleiste, auf einer Linie mit Suche und Glocke */}
      <InKopfzeile>
        <h2 id="start-zahlen" className="m-0 font-semibold text-lg">
          {m.start_numbers()}
        </h2>
      </InKopfzeile>
      <dl className="m-0 grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Archiv start={start} />
        <Eingang start={start} />
        {start.speicher && <Speicher speicher={start.speicher} />}
        {start.loeschantraege !== undefined && <Pflege start={start} />}
      </dl>
    </section>
  );
}
