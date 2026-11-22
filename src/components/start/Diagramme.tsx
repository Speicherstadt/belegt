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

/** Anteil als kleiner Ring mit der Prozentzahl in der Mitte (32 px) */
export function Ring({ anteil }: { anteil: number }) {
  const r = 13;
  const umfang = 2 * Math.PI * r;
  const wert = Math.min(1, Math.max(0, anteil));
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0 text-fg">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${umfang * wert} ${umfang}`}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}

/** Belegung eines Datenträgers als Reihe von Segmenten wie eine Festplattenanzeige: Originale, übrig belegt, frei */
export function Belegung({ originale, belegt }: { originale: number; belegt: number }) {
  const zellen = 20;
  return (
    <div aria-hidden="true" className="flex h-8 items-stretch gap-[3px]">
      {Array.from({ length: zellen }, (_, i) => {
        const mitte = (i + 0.5) / zellen;
        // Die Originale bekommen mindestens ein Segment, sobald es welche gibt
        const art = (originale > 0 && i === 0) || mitte <= originale ? "o" : mitte <= belegt ? "b" : "f";
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: feste Zahl von Segmenten
            key={i}
            className={`flex-1 rounded-[3px] border ${
              art === "o" ? "border-fg bg-fg" : art === "b" ? "border-muted/60 bg-muted/45" : "border-border"
            }`}
          />
        );
      })}
    </div>
  );
}
