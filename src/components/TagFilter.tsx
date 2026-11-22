import { useEffect, useRef, useState } from "react";
import { FARBEN } from "../../shared/ordnung.ts";
import type { ListenFilter, Tag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

const punkt = (t: Tag) => (
  <span
    aria-hidden="true"
    className="size-2.5 shrink-0 rounded-full border border-black/20"
    style={{ backgroundColor: FARBEN[t.farbe]?.hintergrund }}
  />
);

/**
 * Tags im Filter des Archivs: ein Knopf öffnet eine Liste mit Suche und der Zahl der Dokumente je Tag, statt alle Tags
 * als Chips untereinander zu zeigen. Gewählte Tags stehen daneben und lassen sich dort mit × lösen
 */
export function TagFilter({
  tags,
  filter,
  onChange,
}: {
  tags: Tag[];
  filter: ListenFilter;
  onChange: (f: ListenFilter) => void;
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

  // Erster Klick wählt, zweiter schließt aus, dritter hebt beides auf
  const umschalten = (id: string) => {
    const drin = filter.tags.includes(id);
    const raus = filter.tagsNicht.includes(id);
    onChange({
      ...filter,
      tags: drin ? filter.tags.filter((t) => t !== id) : raus ? filter.tags : [...filter.tags, id],
      tagsNicht: drin ? [...filter.tagsNicht, id] : filter.tagsNicht.filter((t) => t !== id),
    });
  };
  const loesen = (id: string) =>
    onChange({
      ...filter,
      tags: filter.tags.filter((t) => t !== id),
      tagsNicht: filter.tagsNicht.filter((t) => t !== id),
    });
  const gewaehlt = tags.filter((t) => filter.tags.includes(t.id) || filter.tagsNicht.includes(t.id));
  const anzahl = gewaehlt.length + (filter.ohneTags ? 1 : 0);
  const treffer = tags.filter((t) => t.name.toLowerCase().includes(suche.trim().toLowerCase()));

  return (
    <div ref={rahmen} className="relative flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        aria-expanded={offen}
        onClick={() => setOffen(!offen)}
        className="flex h-9 items-center gap-2 rounded-md border border-border px-3 font-medium hover:bg-subtle aria-expanded:bg-subtle"
      >
        {m.filter_tags()}
        {!!anzahl && (
          <span className="rounded-full bg-primary px-1.5 text-onprimary text-xs tabular-nums">{anzahl}</span>
        )}
        <span aria-hidden="true">▾</span>
      </button>
      {gewaehlt.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => loesen(t.id)}
          aria-label={m.filter_tag_remove({ name: t.name })}
          className="flex h-8 items-center gap-2 rounded-full border border-border px-3 hover:bg-subtle"
        >
          {punkt(t)}
          {filter.tagsNicht.includes(t.id) ? <s>{t.name}</s> : t.name}
          <span aria-hidden="true">×</span>
        </button>
      ))}
      {filter.ohneTags && (
        <button
          type="button"
          onClick={() => onChange({ ...filter, ohneTags: false })}
          aria-label={m.filter_tag_remove({ name: m.filter_tags_without() })}
          className="flex h-8 items-center gap-2 rounded-full border border-border px-3 italic hover:bg-subtle"
        >
          {m.filter_tags_without()}
          <span aria-hidden="true">×</span>
        </button>
      )}
      {offen && (
        <div className="absolute top-10 left-0 z-20 flex w-72 flex-col gap-2 rounded-lg border border-border bg-bg p-2 shadow-lg">
          <input
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder={m.filter_tags_search()}
            aria-label={m.filter_tags_search()}
            className={feldKlasse}
          />
          {filter.tags.length > 1 && (
            <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">{m.filter_tags_mode()}</legend>
              {(["alle", "einer"] as const).map((modus) => (
                <button
                  key={modus}
                  type="button"
                  aria-pressed={filter.tagModus === modus}
                  onClick={() => onChange({ ...filter, tagModus: modus })}
                  className="h-7 flex-1 rounded-md border border-border px-2 font-medium hover:bg-subtle aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-onprimary"
                >
                  {modus === "alle" ? m.filter_tags_all() : m.filter_tags_any()}
                </button>
              ))}
            </fieldset>
          )}
          <p className="m-0 px-1 text-muted text-xs">{m.filter_tags_hint()}</p>
          <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
            <li>
              <button
                type="button"
                aria-pressed={filter.ohneTags}
                onClick={() => onChange({ ...filter, ohneTags: !filter.ohneTags })}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left italic hover:bg-subtle aria-pressed:font-medium"
              >
                <span aria-hidden="true" className="w-4 text-center">
                  {filter.ohneTags ? "✓" : ""}
                </span>
                {m.filter_tags_without()}
              </button>
            </li>
            {treffer.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={filter.tags.includes(t.id) ? true : filter.tagsNicht.includes(t.id) ? "mixed" : false}
                  aria-description={filter.tagsNicht.includes(t.id) ? m.filter_tag_excluded() : undefined}
                  onClick={() => umschalten(t.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-subtle aria-pressed:font-medium"
                >
                  <span aria-hidden="true" className="w-4 text-center">
                    {filter.tags.includes(t.id) ? "✓" : filter.tagsNicht.includes(t.id) ? "⊘" : ""}
                  </span>
                  {punkt(t)}
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span aria-hidden="true" className="text-muted text-xs tabular-nums">
                    {t.anzahl}
                  </span>
                </button>
              </li>
            ))}
            {!treffer.length && <li className="px-2 py-1.5 text-muted">{m.filter_tags_none()}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
