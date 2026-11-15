import type { Art, GelernterVorschlag, OrdnungsVorschlag } from "../lib/api.ts";
import { artLabel } from "../lib/arten.ts";
import { m } from "../paraglide/messages.js";
import { SuggestionOrder } from "./SuggestionOrder.tsx";
import { TagChip } from "./TagChip.tsx";

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

const grund = (e: { anzahl: number; woerter: string[] }) =>
  e.woerter.length
    ? m.suggest_learned_reason_words({ anzahl: String(e.anzahl), woerter: e.woerter.join(", ") })
    : m.suggest_learned_reason({ anzahl: String(e.anzahl) });

/**
 * Was Belegt aus den eigenen Einordnungen gelernt hat, jedes mit Begründung („wie 7 Dokumente …“). Übernehmen setzt
 * Korrespondent, Dokumenttyp und Tags sofort und trägt die Art ins Formular; eingeordnet wird erst mit „Einordnen“.
 */
export function LearnedSuggestion({
  gelernt,
  onArt,
  onOrdnung,
}: {
  gelernt: GelernterVorschlag;
  onArt: (art: Art) => void;
  onOrdnung: (o: OrdnungsVorschlag) => void;
}) {
  const ordnung: OrdnungsVorschlag = {
    tags: gelernt.tags,
    dokumenttyp: gelernt.dokumenttyp,
    korrespondent: gelernt.korrespondent,
    felder: [],
  };
  const mitOrdnung = !!(gelernt.korrespondent || gelernt.dokumenttyp || gelernt.tags.length);
  return (
    <div className={kasten}>
      <p className="m-0">{m.suggest_learned()}</p>
      <ul className="m-0 flex flex-col gap-1 pl-5">
        {gelernt.art && (
          <li>
            {m.suggest_learned_kind({ art: artLabel(gelernt.art.wert) })}{" "}
            <span className="text-muted">{grund(gelernt.art)}</span>
          </li>
        )}
        {gelernt.korrespondent && (
          <li>
            {m.suggest_party_short({ name: gelernt.korrespondent.name })}{" "}
            <span className="text-muted">{grund(gelernt.korrespondent)}</span>
          </li>
        )}
        {gelernt.dokumenttyp && (
          <li>
            {m.suggest_doctype_short({ typ: gelernt.dokumenttyp.name })}{" "}
            <span className="text-muted">{grund(gelernt.dokumenttyp)}</span>
          </li>
        )}
        {gelernt.tags.map((t) => (
          <li key={t.id}>
            <TagChip tag={t} /> <span className="text-muted">{grund(t)}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          if (gelernt.art) onArt(gelernt.art.wert);
          if (mitOrdnung) onOrdnung(ordnung);
        }}
        className={knopf}
      >
        {m.suggest_apply()}
      </button>
    </div>
  );
}
