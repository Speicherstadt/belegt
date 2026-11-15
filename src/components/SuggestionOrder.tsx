import type { OrdnungAenderung, OrdnungsVorschlag } from "../lib/api.ts";
import { feldwertText } from "../lib/ordnung.ts";
import { m } from "../paraglide/messages.js";
import { TagChip } from "./TagChip.tsx";

/** Die Änderung, die ein Vorschlag beim Übernehmen setzt */
export const alsAenderung = (o: OrdnungsVorschlag): OrdnungAenderung => ({
  tagsHinzu: o.tags.map((t) => t.id),
  ...(o.dokumenttyp ? { dokumenttyp: o.dokumenttyp.id } : {}),
  ...(o.korrespondent ? { korrespondent: o.korrespondent.id } : {}),
  felder: o.felder.map((f) => ({ feldId: f.feldId, wert: f.wert })),
});

/** Was ein Vorschlag an Korrespondent, Tags, Dokumenttyp und Feldwerten mitbringt */
export function SuggestionOrder({ ordnung }: { ordnung: OrdnungsVorschlag }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {ordnung.korrespondent && <span>{m.suggest_party_short({ name: ordnung.korrespondent.name })}</span>}
      {ordnung.dokumenttyp && <span>{m.suggest_doctype_short({ typ: ordnung.dokumenttyp.name })}</span>}
      {ordnung.tags.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {ordnung.felder.map((f) => (
        <span key={f.feldId}>
          {f.name}: {feldwertText(f.typ, f.wert)}
        </span>
      ))}
    </span>
  );
}
