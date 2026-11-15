import { Link } from "@tanstack/react-router";
import type { Eintrag } from "../lib/api.ts";
import { artLabel } from "../lib/arten.ts";
import { groesse, tag, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { TagChip } from "./TagChip.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

export function aufbewahrung(d: Eintrag): string {
  if (!d.art) return m.retention_open();
  if (!d.fristBis) return artLabel(d.art);
  return `${artLabel(d.art)}, ${m.retention_until({ datum: tag(d.fristBis) })}`;
}

/** Was Tabelle und Kacheln zur Auswahl brauchen; ohne schreiben gibt es keine Kästchen */
export interface Auswahl {
  schreiben: boolean;
  gewaehlt: Set<string>;
  umschalten: (id: string) => void;
  alleGewaehlt: boolean;
  alleUmschalten: () => void;
}

export const name = (d: Eintrag) => d.titel ?? d.dateiname ?? m.unnamed();

export function Ordnungszeile({ d }: { d: Eintrag }) {
  if (!d.dokumenttyp && d.tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
      {d.dokumenttyp && <span className="text-muted text-xs">{d.dokumenttyp.name}</span>}
      {d.tags.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
    </span>
  );
}

/** Die Liste als Tabelle, mit Vorschaubild vor dem Namen */
export function DocumentTable({ eintraege, auswahl }: { eintraege: Eintrag[]; auswahl: Auswahl }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <section aria-label={m.list_label()} tabIndex={0} className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-border border-b text-left text-muted">
            {auswahl.schreiben && (
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={auswahl.alleGewaehlt}
                  onChange={auswahl.alleUmschalten}
                  aria-label={m.bulk_select_page()}
                  className="size-4"
                />
              </th>
            )}
            <th className="px-3 py-2.5 text-right font-medium">{m.col_asn()}</th>
            <th className="w-14 px-1 py-2.5">
              <span className="sr-only">{m.col_thumbnail()}</span>
            </th>
            <th className="px-3 py-2.5 font-medium">{m.col_name()}</th>
            <th className="px-3 py-2.5 font-medium">{m.col_retention()}</th>
            <th className="px-3 py-2.5 font-medium">{m.col_type()}</th>
            <th className="px-3 py-2.5 text-right font-medium">{m.col_size()}</th>
            <th className="px-3 py-2.5 text-right font-medium">{m.col_received()}</th>
          </tr>
        </thead>
        <tbody>
          {eintraege.map((d) => (
            <tr key={d.id} className="border-border border-b last:border-b-0 hover:bg-subtle">
              {auswahl.schreiben && (
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={auswahl.gewaehlt.has(d.id)}
                    onChange={() => auswahl.umschalten(d.id)}
                    aria-label={m.bulk_select({ name: name(d) })}
                    className="size-4"
                  />
                </td>
              )}
              <td className="px-3 py-3 text-right text-muted tabular-nums">{d.asn}</td>
              <td className="px-1 py-2">
                <Thumbnail dokument={d} />
              </td>
              <td className="px-3 py-3 font-medium">
                <Link to="/dokumente/$id" params={{ id: d.id }} className="underline-offset-2 hover:underline">
                  {name(d)}
                </Link>
                <Ordnungszeile d={d} />
              </td>
              <td className="px-3 py-3">{aufbewahrung(d)}</td>
              <td className="px-3 py-3 text-muted">{d.mimeType}</td>
              <td className="px-3 py-3 text-right tabular-nums">{groesse(d.groesse)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{zeitpunkt(d.eingegangenAm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Die Liste als Kacheln mit großem Vorschaubild */
export function DocumentGrid({ eintraege, auswahl }: { eintraege: Eintrag[]; auswahl: Auswahl }) {
  return (
    <section aria-label={m.list_label()} className="flex flex-col gap-3">
      {auswahl.schreiben && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auswahl.alleGewaehlt} onChange={auswahl.alleUmschalten} className="size-4" />
          {m.bulk_select_page()}
        </label>
      )}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 p-0">
        {eintraege.map((d) => (
          <li key={d.id} className="relative flex flex-col gap-2 rounded-lg border border-border p-2 hover:bg-subtle">
            <Thumbnail dokument={d} gross />
            <div className="flex items-start gap-2">
              {auswahl.schreiben && (
                <input
                  type="checkbox"
                  checked={auswahl.gewaehlt.has(d.id)}
                  onChange={() => auswahl.umschalten(d.id)}
                  aria-label={m.bulk_select({ name: name(d) })}
                  className="mt-0.5 size-4 shrink-0"
                />
              )}
              <div className="flex min-w-0 flex-col text-sm">
                <Link
                  to="/dokumente/$id"
                  params={{ id: d.id }}
                  className="break-words font-medium underline-offset-2 hover:underline"
                >
                  {name(d)}
                </Link>
                <span className="text-muted text-xs tabular-nums">
                  {m.col_asn()} {d.asn} · {zeitpunkt(d.eingegangenAm)}
                </span>
                <span className="text-xs">{aufbewahrung(d)}</span>
                <Ordnungszeile d={d} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
