import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Lock, ShieldCheck, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { api, type Start } from "../../lib/api.ts";
import { groesse } from "../../lib/format.ts";
import { m } from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";
import { siegelZustand } from "../SealBadge.tsx";
import { BereichSymbol } from "../Symbole.tsx";
import { Belegung, Kurve, Ring } from "./Diagramme.tsx";

/*
 * Überblick der Startseite als Raster ungleich breiter Karten (DESIGN.md, Startseite): Archiv doppelt breit mit dem
 * Verlauf der letzten zwölf Monate, Eingang als Ring, Speicher als Belegung des Datenträgers, Pflege als kurze Liste.
 * Jede Karte ist eine Gruppe aus dt und dd in einer Beschreibungsliste; Diagramme sind schmückend.
 */

const karte = "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-linear-to-b from-subtle to-bg to-60% p-4";

function Kopf({ bereich, symbol, children }: { bereich?: string; symbol?: ReactNode; children: ReactNode }) {
  return (
    <dt className="flex items-center gap-2 font-medium text-muted text-xs">
      {bereich ? <BereichSymbol bereich={bereich} className="size-4" /> : symbol}
      {children}
    </dt>
  );
}

function Weiter({ to, children }: { to: string; children: ReactNode }) {
  return (
    <dd className="m-0 mt-auto text-xs">
      <Link to={to} className="text-muted underline-offset-2 hover:text-fg hover:underline">
        {children} →
      </Link>
    </dd>
  );
}

/** Monatsnamen kurz in der Sprache der Oberfläche: der erste, der mittlere und der laufende */
function monate(anzahl: number) {
  const format = new Intl.DateTimeFormat(getLocale(), { month: "short" });
  const jetzt = new Date();
  const name = (zurueck: number) => format.format(new Date(jetzt.getFullYear(), jetzt.getMonth() - zurueck, 1));
  return [name(anzahl - 1), name(Math.floor((anzahl - 1) / 2)), name(0)];
}

function Archiv({ start }: { start: Start }) {
  const trend = start.vorjahr > 0 ? Math.round(((start.diesesJahr - start.vorjahr) / start.vorjahr) * 100) : null;
  const Pfeil = trend !== null && trend < 0 ? TrendingDown : TrendingUp;
  return (
    <div className={`${karte} lg:col-span-2`}>
      <Kopf bereich="/archiv">{m.start_total()}</Kopf>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <dd className="m-0 font-semibold text-4xl tabular-nums tracking-tight">{start.gesamt}</dd>
        {trend !== null && (
          <dd className="m-0 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-semibold text-xs">
            <Pfeil aria-hidden="true" className="size-3.5" />
            {m.start_trend({ prozent: `${trend > 0 ? "+" : ""}${trend} %` })}
          </dd>
        )}
      </div>
      <dd className="m-0 flex items-center gap-1.5 text-muted text-xs">
        <CalendarDays aria-hidden="true" className="size-3.5" />
        {m.start_this_year_short({ anzahl: String(start.diesesJahr) })}
      </dd>
      <dd className="m-0">
        <Kurve werte={start.verlauf} label={m.start_chart_label()} />
        <span aria-hidden="true" className="mt-1 flex justify-between text-muted text-xs">
          {monate(start.verlauf.length).map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: drei feste Stellen der Achse
            <span key={i}>{n}</span>
          ))}
        </span>
      </dd>
    </div>
  );
}

function Eingang({ start }: { start: Start }) {
  const fertig = start.gesamt - start.eingang;
  return (
    <div className={karte}>
      <Kopf bereich="/eingang">{m.start_inbox()}</Kopf>
      <dd className="m-0 font-semibold text-4xl tabular-nums tracking-tight">{start.eingang}</dd>
      <dd className="m-0 flex items-center gap-3">
        <Ring anteil={start.gesamt ? fertig / start.gesamt : 1} />
        <span className="text-muted text-xs">
          {m.start_sorted({ fertig: String(fertig), gesamt: String(start.gesamt) })}
        </span>
      </dd>
      <Weiter to="/eingang">{m.start_inbox_link()}</Weiter>
    </div>
  );
}

function Speicher({ speicher }: { speicher: NonNullable<Start["speicher"]> }) {
  const d = speicher.datentraeger;
  return (
    <div className={karte}>
      <Kopf bereich="#speicher">{m.start_storage()}</Kopf>
      <dd className="m-0 font-semibold text-4xl tabular-nums tracking-tight">{groesse(speicher.bytes)}</dd>
      {d && (
        <dd className="m-0 flex flex-col gap-2">
          <Belegung originale={speicher.bytes / d.gesamt} belegt={(d.gesamt - d.frei) / d.gesamt} />
          <span className="flex flex-wrap gap-x-3 text-muted text-xs">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-sm bg-fg" />
              {m.start_legend_originals()}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-sm bg-muted/60" />
              {m.start_legend_used()}
            </span>
            <span>{m.start_disk_free({ frei: groesse(d.frei) })}</span>
          </span>
        </dd>
      )}
      <dd className="m-0 mt-auto text-muted text-xs">
        {d && `${m.start_disk_of({ gesamt: groesse(d.gesamt) })} · `}
        {m.start_storage_hint({ anzahl: String(speicher.dateien) })}
      </dd>
    </div>
  );
}

function Pflege({ start }: { start: Start }) {
  const kette = useQuery({ queryKey: ["kette"], queryFn: api.kette });
  const zustand = kette.data ? siegelZustand(kette.data.lauf) : null;
  const zeile =
    "flex items-center justify-between gap-2 border-border border-t py-2 text-sm first:border-t-0 first:pt-0";
  const antraege = start.loeschantraege ?? 0;
  return (
    <div className={karte}>
      <Kopf symbol={<ShieldCheck aria-hidden="true" className="size-4" />}>{m.start_care()}</Kopf>
      <dd className="m-0">
        <dl className="m-0">
          <div className={zeile}>
            <dt className="flex items-center gap-2">
              <Trash2 aria-hidden="true" className="size-4 text-muted" />
              {m.start_deletion_requests()}
            </dt>
            <dd className="m-0 flex items-center gap-1.5 font-semibold tabular-nums">
              {antraege > 0 && <span aria-hidden="true" className="size-2 rounded-full bg-warn" />}
              {antraege}
            </dd>
          </div>
          {start.sperren && (
            <div className={zeile}>
              <dt className="flex items-center gap-2">
                <Lock aria-hidden="true" className="size-4 text-muted" />
                {m.start_holds()}
              </dt>
              <dd className="m-0 font-semibold tabular-nums">{start.sperren.aktiv}</dd>
            </div>
          )}
          {zustand && (
            <div className={zeile}>
              <dt className="flex items-center gap-2">
                <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
                {m.start_seal()}
              </dt>
              <dd
                className={`m-0 font-semibold ${zustand === "gut" ? "text-ok" : zustand === "befund" ? "text-danger" : "text-warn"}`}
              >
                {zustand === "gut" ? "✓" : zustand === "befund" ? "✕" : "!"}
                <span className="sr-only">
                  {zustand === "gut"
                    ? m.seal_ok()
                    : zustand === "befund"
                      ? m.seal_findings({ anzahl: String(kette.data?.lauf?.befunde ?? 0) })
                      : m.seal_never()}
                </span>
              </dd>
            </div>
          )}
        </dl>
      </dd>
      <Weiter to="/fristen">{m.start_retention_link()}</Weiter>
    </div>
  );
}

/** Zahlen der Startseite; Speicher und Pflege nur, wenn der Server sie für die Rolle liefert */
export function Ueberblick({ start }: { start: Start }) {
  const karten = 3 + (start.speicher ? 1 : 0) + (start.loeschantraege !== undefined ? 1 : 0);
  return (
    <section aria-labelledby="start-zahlen" className="flex flex-col gap-3">
      <h2 id="start-zahlen" className="m-0 font-semibold text-lg">
        {m.start_numbers()}
      </h2>
      <dl
        className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(var(--spalten),minmax(0,1fr))]"
        style={{ "--spalten": karten } as CSSProperties}
      >
        <Archiv start={start} />
        <Eingang start={start} />
        {start.speicher && <Speicher speicher={start.speicher} />}
        {start.loeschantraege !== undefined && <Pflege start={start} />}
      </dl>
    </section>
  );
}
