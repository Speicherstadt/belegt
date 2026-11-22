/*
 * Kleine Diagramme für die Kennzahlen der Startseite, nach den Regeln für Kennzahl-Kacheln (DESIGN.md, Startseite):
 * einfarbig, die Vergangenheit zurückgenommen (--muted), das Aktuelle in --fg, die leere Spur in --border.
 */

/** Zwölf Monate als schmale Balken mit 2 px Lücke; der laufende Monat betont, jeder Balken mit Tooltip */
export function Verlauf({ werte, monate, label }: { werte: number[]; monate: string[]; label: string }) {
  const max = Math.max(1, ...werte);
  return (
    <div role="img" aria-label={label} className="flex h-8 items-end gap-0.5">
      {werte.map((w, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: zwölf feste Monate
          key={i}
          title={`${monate[i]}: ${w}`}
          className={`min-h-0.5 flex-1 rounded-t-[3px] ${i === werte.length - 1 ? "bg-fg" : "bg-muted/45 hover:bg-muted"}`}
          style={{ height: `${Math.max(6, (w / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** Anteil als schmale Leiste (8 px, ganz gerundet) auf einer Spur in --border */
export function Leiste({ teile }: { teile: { anteil: number; klasse: string }[] }) {
  return (
    <div aria-hidden="true" className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-border">
      {teile
        .filter((t) => t.anteil > 0)
        .map((t) => (
          <span
            key={t.klasse}
            className={`h-full rounded-full ${t.klasse}`}
            style={{ width: `${Math.max(1.5, Math.min(100, t.anteil * 100))}%` }}
          />
        ))}
    </div>
  );
}
