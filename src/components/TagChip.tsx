import type { CSSProperties } from "react";
import { FARBEN } from "../../shared/ordnung.ts";
import type { TagKurz } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/**
 * Tag als Badge mit Rand wie die Outline-Badge von shadcn/ui: Name in --fg, die Farbe des Tags nur als Punkt davor
 * (DESIGN.md, Tags). Hell trägt der Punkt die dunkle Schriftfarbe, dunkel die helle Hintergrundfarbe der Palette, damit
 * er auf beiden Gründen sichtbar bleibt. Mit onEntfernen ein Knopf zum Entfernen.
 */
export function TagChip({ tag, onEntfernen }: { tag: TagKurz; onEntfernen?: () => void }) {
  const farbe = FARBEN[tag.farbe] ?? FARBEN.grau;
  return (
    <span
      style={{ "--punkt-hell": farbe.schrift, "--punkt-dunkel": farbe.hintergrund } as CSSProperties}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-border bg-bg px-2 font-medium text-fg text-xs"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-(--punkt-hell) dark:bg-(--punkt-dunkel)" />
      <span className="truncate">{tag.name}</span>
      {onEntfernen && (
        <button
          type="button"
          onClick={onEntfernen}
          aria-label={m.tag_remove({ name: tag.name })}
          className="-mr-1 flex size-5 items-center justify-center rounded-sm hover:bg-subtle"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}
