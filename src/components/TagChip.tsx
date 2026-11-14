import { FARBEN } from "../../shared/ordnung.ts";
import type { TagKurz } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Tag als Chip in seiner Farbe; mit onEntfernen ein Knopf zum Entfernen */
export function TagChip({ tag, onEntfernen }: { tag: TagKurz; onEntfernen?: () => void }) {
  const farbe = FARBEN[tag.farbe] ?? FARBEN.grau;
  return (
    <span
      style={{ backgroundColor: farbe.hintergrund, color: farbe.schrift }}
      className="inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 font-medium text-xs"
    >
      <span className="truncate">{tag.name}</span>
      {onEntfernen && (
        <button
          type="button"
          onClick={onEntfernen}
          aria-label={m.tag_remove({ name: tag.name })}
          className="-mr-1 flex size-5 items-center justify-center rounded-full hover:bg-black/10"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}
