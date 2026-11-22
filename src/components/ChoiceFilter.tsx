import { useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

export interface Wahl {
  id: string;
  name: string;
  anzahl: number;
}

/**
 * Ein Filter mit genau einer Wahl (Korrespondent, Dokumenttyp) als Knopf mit Liste: Suche, „Alle“, „Ohne …“ und die
 * Einträge mit der Zahl ihrer Dokumente. Der Knopf zeigt, was gewählt ist; × daneben hebt die Wahl auf
 */
export function ChoiceFilter({
  label,
  ohneLabel,
  eintraege,
  wert,
  onChange,
}: {
  label: string;
  ohneLabel: string;
  eintraege: Wahl[];
  /** ID, „ohne“ oder leer für alle */
  wert: string;
  onChange: (wert: string) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const rahmen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!offen) return;
    const zu = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !rahmen.current?.contains(e.target as Node))
        setOffen(false);
    };
    document.addEventListener("mousedown", zu);
    document.addEventListener("keydown", zu);
    return () => {
      document.removeEventListener("mousedown", zu);
      document.removeEventListener("keydown", zu);
    };
  }, [offen]);

  const waehlen = (neu: string) => {
    onChange(neu);
    setOffen(false);
    setSuche("");
  };
  const gewaehlt = wert === "ohne" ? ohneLabel : eintraege.find((e) => e.id === wert)?.name;
  const treffer = eintraege.filter((e) => e.name.toLowerCase().includes(suche.trim().toLowerCase()));
  const zeile =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-subtle aria-pressed:font-medium";
  const haken = (an: boolean) => (
    <span aria-hidden="true" className="w-4 text-center">
      {an ? "✓" : ""}
    </span>
  );

  return (
    <div ref={rahmen} className="relative flex items-center gap-1 text-sm">
      <button
        type="button"
        aria-expanded={offen}
        aria-label={gewaehlt ? `${label}: ${gewaehlt}` : label}
        onClick={() => setOffen(!offen)}
        className={`flex h-9 items-center gap-2 rounded-md border px-3 font-medium hover:bg-subtle aria-expanded:bg-subtle ${
          wert ? "border-primary" : "border-border"
        }`}
      >
        {label}
        {gewaehlt && <span className="max-w-48 truncate font-normal">: {gewaehlt}</span>}
        <span aria-hidden="true">▾</span>
      </button>
      {wert && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={m.filter_choice_clear({ name: label })}
          className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      {offen && (
        <div className="absolute top-10 left-0 z-20 flex w-72 flex-col gap-2 rounded-lg border border-border bg-bg p-2 shadow-lg">
          <input
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={m.filter_choice_search({ name: label })}
            aria-label={m.filter_choice_search({ name: label })}
            className={feldKlasse}
          />
          <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
            <li>
              <button type="button" aria-pressed={!wert} onClick={() => waehlen("")} className={zeile}>
                {haken(!wert)}
                {m.filter_choice_all()}
              </button>
            </li>
            <li>
              <button type="button" aria-pressed={wert === "ohne"} onClick={() => waehlen("ohne")} className={zeile}>
                {haken(wert === "ohne")}
                <span className="italic">{ohneLabel}</span>
              </button>
            </li>
            {treffer.map((e) => (
              <li key={e.id}>
                <button type="button" aria-pressed={wert === e.id} onClick={() => waehlen(e.id)} className={zeile}>
                  {haken(wert === e.id)}
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span aria-hidden="true" className="text-muted text-xs tabular-nums">
                    {e.anzahl}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
