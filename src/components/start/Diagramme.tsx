import { useId } from "react";

/*
 * Kleine Diagramme für den Überblick der Startseite, in den Farben der Schrift (currentColor, --muted, --border):
 * schwarz-weiß wie die übrige Oberfläche (DESIGN.md). Rein schmückend; die Zahlen daneben sagen dasselbe.
 */

/** Verlauf als Linie mit zarter Fläche darunter; der letzte Wert ist ein Punkt */
export function Kurve({ werte, label }: { werte: number[]; label: string }) {
  const verlauf = useId();
  const breite = 420;
  const hoehe = 80;
  const max = Math.max(1, ...werte);
  const punkte = werte.map((w, i) => [
    werte.length > 1 ? (i * breite) / (werte.length - 1) : breite,
    hoehe - 6 - (w / max) * (hoehe - 16),
  ]);
  const linie = `M${punkte.map((p) => p.join(",")).join(" L")}`;
  const letzter = punkte.at(-1) ?? [breite, hoehe];
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${breite} ${hoehe}`}
      preserveAspectRatio="none"
      className="h-20 w-full overflow-visible text-fg"
    >
      <defs>
        <linearGradient id={verlauf} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${linie} L${breite},${hoehe} L0,${hoehe}Z`} fill={`url(#${verlauf})`} />
      <path d={linie} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={letzter[0]} cy={letzter[1]} r="3.5" fill="currentColor" />
    </svg>
  );
}

/** Anteil als Ring mit der Prozentzahl in der Mitte */
export function Ring({ anteil }: { anteil: number }) {
  const r = 30;
  const umfang = 2 * Math.PI * r;
  const wert = Math.min(1, Math.max(0, anteil));
  return (
    <svg aria-hidden="true" viewBox="0 0 80 80" className="size-20 shrink-0 text-fg">
      <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${umfang * wert} ${umfang}`}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="45" textAnchor="middle" fontSize="15" fontWeight="650" fill="currentColor">
        {Math.round(wert * 100)}%
      </text>
    </svg>
  );
}

/** Belegung eines Datenträgers als Reihe von Segmenten: Originale, übrig belegt, frei */
export function Belegung({ originale, belegt }: { originale: number; belegt: number }) {
  const zellen = 24;
  return (
    <div aria-hidden="true" className="flex gap-[3px]">
      {Array.from({ length: zellen }, (_, i) => {
        const p = (i + 0.5) / zellen;
        const art = p <= Math.max(originale, originale > 0 ? 0.5 / zellen : 0) ? "o" : p <= belegt ? "b" : "f";
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: feste Zahl von Zellen ohne eigene Kennung
            key={i}
            className={`h-5 flex-1 rounded-[3px] border ${
              art === "o"
                ? "border-fg bg-fg"
                : art === "b"
                  ? "border-muted bg-muted/60"
                  : "border-border bg-transparent"
            }`}
          />
        );
      })}
    </div>
  );
}
