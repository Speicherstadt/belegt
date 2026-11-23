import { Link, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";

/*
 * Reiter einer Seite, der gewählte steht in der Adresse (?bereich=), damit ein Link genau dort landet und Zurück
 * funktioniert. Gleich gebaut wie auf Ordnung und am Dokument (DESIGN.md, Reiter).
 */

/** Der gewählte Bereich aus der Adresse; ohne oder mit unbekanntem Wert die Vorgabe */
export function useBereich<T extends string>(bereiche: readonly T[], vorgabe: T): T {
  const search = useSearch({ strict: false }) as { bereich?: string };
  return bereiche.includes(search.bereich as T) ? (search.bereich as T) : vorgabe;
}

export function Reiterleiste<T extends string>({
  pfad,
  bereiche,
  aktiv,
  vorgabe,
  namen,
  label,
  rechts,
}: {
  pfad: string;
  bereiche: readonly T[];
  aktiv: T;
  /** Der Bereich ohne ?bereich= in der Adresse */
  /** Reiter ohne ?bereich= in der Adresse; ohne Vorgabe schreibt jeder Reiter seinen Bereich hinein */
  vorgabe?: T;
  namen: Record<T, () => string>;
  label: string;
  /** Etwas rechts in der Leiste, etwa die Hauptaktion des Bereichs */
  rechts?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-border border-b">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
        {bereiche.map((b) => (
          <Link
            key={b}
            role="tab"
            aria-selected={aktiv === b}
            to={pfad}
            search={b === vorgabe ? {} : { bereich: b }}
            replace
            className="-mb-px border-transparent border-b-2 px-3 py-2 font-medium text-muted text-sm hover:text-fg aria-selected:border-fg aria-selected:text-fg"
          >
            {namen[b]()}
          </Link>
        ))}
      </div>
      {rechts && <div className="mb-2">{rechts}</div>}
    </div>
  );
}
