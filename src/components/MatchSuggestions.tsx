import type { OrdnungsVorschlag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { SuggestionOrder } from "./SuggestionOrder.tsx";

const kasten = "flex flex-col gap-2 rounded-md border border-border bg-subtle p-2 text-sm";
const knopf = "h-8 self-start rounded-md border border-border bg-bg px-3 font-medium";

/** Vorschlag der Zuordnungsregeln an Korrespondenten, Dokumenttypen und Tags */
export function RuleMatchSuggestion({
  zuordnung,
  onUebernehmen,
}: {
  zuordnung: OrdnungsVorschlag & { uebersprungen: string[] };
  onUebernehmen: (o: OrdnungsVorschlag) => void;
}) {
  return (
    <div className={kasten}>
      <p className="m-0">{m.suggest_match()}</p>
      <SuggestionOrder ordnung={zuordnung} />
      {zuordnung.uebersprungen.length > 0 && (
        <p className="m-0 text-muted text-xs">
          {m.suggest_match_skipped({ namen: zuordnung.uebersprungen.join(", ") })}
        </p>
      )}
      <button type="button" onClick={() => onUebernehmen(zuordnung)} className={knopf}>
        {m.suggest_apply()}
      </button>
    </div>
  );
}
