import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Sortierung } from "../../shared/archivansicht.ts";
import { dateiUrl, type Eintrag } from "../lib/api.ts";
import { artLabel } from "../lib/arten.ts";
import { groesse, tag, zeitpunkt } from "../lib/format.ts";
import { trefferTeile } from "../lib/treffer.ts";
import { m } from "../paraglide/messages.js";
import { PartyChip } from "./PartyChip.tsx";
import { hatVorschau, PreviewDialog } from "./PreviewDialog.tsx";
import { TagChip } from "./TagChip.tsx";
import { Thumbnail } from "./Thumbnail.tsx";

export function aufbewahrung(d: Eintrag): string {
  if (!d.art) return m.retention_open();
  if (!d.fristBis) return artLabel(d.art);
  return `${artLabel(d.art)}, ${m.retention_until({ datum: tag(d.fristBis) })}`;
}

/** Was Tabelle und Kacheln zur Auswahl brauchen; ohne waehlbar gibt es keine Kästchen */
export interface Auswahl {
  waehlbar: boolean;
  gewaehlt: Set<string>;
  umschalten: (id: string) => void;
  alleGewaehlt: boolean;
  alleUmschalten: () => void;
}

/**
 * Kopf einer sortierbaren Spalte: ein Knopf, der nach dieser Spalte sortiert, bei Eingang zwischen neu und alt wechselnd;
 * aria-sort sagt Screenreadern, wonach die Liste gerade sortiert ist. Ohne sortieren ein schlichter Kopf
 */
function SortKopf({
  label,
  auf,
  ab,
  rechts,
  sortierung,
  sortieren,
}: {
  label: string;
  auf: Sortierung;
  ab?: Sortierung;
  rechts: boolean;
  sortierung?: Sortierung;
  sortieren?: (s: Sortierung) => void;
}) {
  const aktiv = sortierung === auf || (!!ab && sortierung === ab);
  // „neu“ heißt absteigend, alles andere aufsteigend (Titel A–Z, Frist die nächste zuerst)
  const richtung = !aktiv ? "none" : sortierung === "neu" ? "descending" : "ascending";
  const klasse = `px-3 py-2.5 font-medium ${rechts ? "text-right" : ""}`;
  if (!sortieren) return <th className={klasse}>{label}</th>;
  return (
    <th className={klasse} aria-sort={richtung}>
      <button
        type="button"
        onClick={() => sortieren(aktiv && ab ? (sortierung === auf ? ab : auf) : auf)}
        className="inline-flex items-center gap-1 rounded hover:text-fg"
      >
        {label}
        <span aria-hidden="true" className={aktiv ? "text-fg" : "opacity-40"}>
          {richtung === "descending" ? "↓" : richtung === "ascending" ? "↑" : "↕"}
        </span>
      </button>
    </th>
  );
}

/** Text mit markierten Suchtreffern */
function Markiert({ text, suche }: { text: string; suche: string }) {
  return (
    <>
      {trefferTeile(text, suche).map((t, i) =>
        t.treffer ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: die Stücke eines Texts haben keine eigene ID, ihre Folge ist fest
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-700/60">
            {t.text}
          </mark>
        ) : (
          t.text
        ),
      )}
    </>
  );
}

/**
 * Ausschnitt aus dem Text, in dem eine Suche trifft (vom Server, Treffer zwischen \u0002 und \u0003): zeigt, warum ein
 * Dokument gefunden wurde, auch wenn das Wort nicht im Namen steht
 */
function Ausschnitt({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="mt-1 line-clamp-3 font-normal text-muted text-xs">
      {text.split("\u0002").map((teil, i) => {
        const [treffer, rest] = i === 0 ? ["", teil] : (teil.split("\u0003") as [string, string?]);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: die Stücke eines Texts haben keine eigene ID, ihre Folge ist fest
          <span key={i}>
            {treffer && <mark className="rounded bg-yellow-200 px-0.5 text-fg dark:bg-yellow-700/60">{treffer}</mark>}
            {rest}
          </span>
        );
      })}
    </span>
  );
}

export const name = (d: Eintrag) => d.titel ?? d.dateiname ?? m.unnamed();

export function Ordnungszeile({ d }: { d: Eintrag }) {
  if (!d.dokumenttyp && !d.korrespondent && d.tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
      {d.korrespondent && <PartyChip korrespondent={d.korrespondent} />}
      {d.dokumenttyp && <span className="text-muted text-xs">{d.dokumenttyp.name}</span>}
      {d.tags.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
    </span>
  );
}

/** Die Liste als Tabelle, mit Vorschaubild vor dem Namen */
export function DocumentTable({
  eintraege,
  auswahl,
  suche = "",
  sortierung,
  sortieren,
}: {
  eintraege: Eintrag[];
  auswahl: Auswahl;
  suche?: string;
  /** Mit sortieren lassen sich Name, Aufbewahrung und Eingang per Klick auf den Spaltenkopf sortieren */
  sortierung?: Sortierung;
  sortieren?: (s: Sortierung) => void;
}) {
  const kopf = (label: string, auf: Sortierung, ab?: Sortierung, rechts = false) => (
    <SortKopf label={label} auf={auf} ab={ab} rechts={rechts} sortierung={sortierung} sortieren={sortieren} />
  );
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: ein scrollbarer Bereich muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <section aria-label={m.list_label()} tabIndex={0} className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-border border-b text-left text-muted">
            {auswahl.waehlbar && (
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
            {kopf(m.col_name(), "titel")}
            {kopf(m.col_retention(), "frist")}
            <th className="px-3 py-2.5 font-medium">{m.col_type()}</th>
            <th className="px-3 py-2.5 text-right font-medium">{m.col_size()}</th>
            {kopf(m.col_received(), "neu", "alt", true)}
          </tr>
        </thead>
        <tbody>
          {eintraege.map((d) => (
            <tr key={d.id} className="border-border border-b last:border-b-0 hover:bg-subtle">
              {auswahl.waehlbar && (
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
                  <Markiert text={name(d)} suche={suche} />
                </Link>
                <Ordnungszeile d={d} />
                <Ausschnitt text={d.ausschnitt} />
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

const PFADE = {
  oeffnen: "M7 17 17 7M9 7h8v8",
  vorschau:
    "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  laden: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14",
};

/** Symbole für die Knöpfe unter einer Kachel: Text passt in die schmale Karte nicht, er steht in aria-label und title */
function KartenSymbol({ art }: { art: keyof typeof PFADE }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none">
      <path d={PFADE[art]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Die Liste als Kacheln: großes Vorschaubild mit den Tags darauf, darunter Korrespondent und Titel, Typ, Eingang und
 * Aufbewahrung, unten Öffnen und Herunterladen
 */
export function DocumentGrid({
  eintraege,
  auswahl,
  suche = "",
  kompakt = false,
}: {
  eintraege: Eintrag[];
  auswahl: Auswahl;
  suche?: string;
  /** Kleine Karten: mehr auf einen Blick, ohne Knöpfe und Aufbewahrung */
  kompakt?: boolean;
}) {
  const [vorschau, setVorschau] = useState<Eintrag | null>(null);
  return (
    <section aria-label={m.list_label()} className="flex flex-col gap-3">
      {vorschau && <PreviewDialog dokument={vorschau} titel={name(vorschau)} onClose={() => setVorschau(null)} />}
      {auswahl.waehlbar && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={auswahl.alleGewaehlt} onChange={auswahl.alleUmschalten} className="size-4" />
          {m.bulk_select_page()}
        </label>
      )}
      <ul
        className={`m-0 grid list-none gap-3 p-0 ${
          kompakt
            ? "grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]"
        }`}
      >
        {eintraege.map((d) => (
          <li
            key={d.id}
            className={`flex flex-col overflow-hidden rounded-lg border hover:shadow-sm ${
              auswahl.gewaehlt.has(d.id) ? "border-primary" : "border-border"
            }`}
          >
            <div className="relative bg-subtle p-2">
              <Thumbnail dokument={d} gross kompakt={kompakt} />
              {auswahl.waehlbar && (
                <input
                  type="checkbox"
                  checked={auswahl.gewaehlt.has(d.id)}
                  onChange={() => auswahl.umschalten(d.id)}
                  aria-label={m.bulk_select({ name: name(d) })}
                  className="absolute top-3 left-3 size-4"
                />
              )}
              {!!d.tags.length && (
                <span className="absolute top-3 right-3 flex max-w-[70%] flex-col items-end gap-1">
                  {d.tags.slice(0, kompakt ? 1 : 3).map((t) => (
                    <TagChip key={t.id} tag={t} />
                  ))}
                  {d.tags.length > (kompakt ? 1 : 3) && (
                    <span className="rounded-md border border-border bg-bg px-1.5 text-xs">+{d.tags.length - (kompakt ? 1 : 3)}</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-3 text-sm">
              {d.korrespondent && <PartyChip korrespondent={d.korrespondent} />}
              <Link
                to="/dokumente/$id"
                params={{ id: d.id }}
                className="break-words font-medium underline-offset-2 hover:underline"
              >
                <Markiert text={name(d)} suche={suche} />
              </Link>
              {!kompakt && <Ausschnitt text={d.ausschnitt} />}
              <span className="text-muted text-xs tabular-nums">
                {d.dokumenttyp ? `${d.dokumenttyp.name} · ` : ""}
                {m.col_asn()} {d.asn} · {zeitpunkt(d.eingegangenAm)}
                {d.seiten ? ` · ${m.card_pages({ anzahl: String(d.seiten) })}` : ""}
              </span>
              {!kompakt && <span className="text-xs">{aufbewahrung(d)}</span>}
            </div>
            <div
              hidden={kompakt}
              className={`grid border-border border-t text-xs ${hatVorschau(d.mimeType) ? "grid-cols-3" : "grid-cols-2"}`}
            >
              <Link
                to="/dokumente/$id"
                params={{ id: d.id }}
                className="flex h-9 items-center justify-center font-medium hover:bg-subtle"
                aria-label={m.card_open_short()}
                title={m.card_open_short()}
              >
                <KartenSymbol art="oeffnen" />
              </Link>
              {hatVorschau(d.mimeType) && (
                <button
                  type="button"
                  onClick={() => setVorschau(d)}
                  className="flex h-9 items-center justify-center border-border border-l font-medium hover:bg-subtle"
                  aria-label={m.card_preview_short()}
                  title={m.card_preview_short()}
                >
                  <KartenSymbol art="vorschau" />
                </button>
              )}
              <a
                href={dateiUrl(d.id)}
                className="flex h-9 items-center justify-center border-border border-l font-medium hover:bg-subtle"
                aria-label={m.card_download_short()}
                title={m.card_download_short()}
              >
                <KartenSymbol art="laden" />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
