import { useQuery } from "@tanstack/react-query";
import type { Recht, Sichtbereich } from "../../shared/rollen.ts";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

export const LEERER_SICHTBEREICH: Sichtbereich = {
  tags: [],
  dokumenttypen: [],
  korrespondenten: [],
  ohneTags: [],
  ohneOrdnung: false,
};

export interface MitarbeiterWahl {
  recht: Recht;
  sichtbereich: Sichtbereich;
}

/** Namen zu den IDs eines Sichtbereichs, für die Zusammenfassung */
export function useNamen() {
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  return {
    tags: tags.data ?? [],
    typen: typen.data ?? [],
    korrespondenten: korrespondenten.data ?? [],
    name: new Map(
      [...(tags.data ?? []), ...(typen.data ?? []), ...(korrespondenten.data ?? [])].map((e) => [e.id, e.name]),
    ),
  };
}

/** Der Sichtbereich in einem Satz, wie in docs/zugaenge.md beschrieben */
export function sichtbereichText(b: Sichtbereich, name: Map<string, string>): string {
  const liste = (ids: string[]) => ids.map((id) => `„${name.get(id) ?? "?"}“`).join(m.scope_or());
  const teile = [
    b.tags.length ? m.scope_text_tags({ liste: liste(b.tags) }) : "",
    b.dokumenttypen.length ? m.scope_text_types({ liste: liste(b.dokumenttypen) }) : "",
    b.korrespondenten.length ? m.scope_text_parties({ liste: liste(b.korrespondenten) }) : "",
  ].filter(Boolean);
  return [
    teile.length ? m.scope_text_with({ teile: teile.join(m.scope_and()) }) : m.scope_text_all(),
    b.ohneTags.length ? m.scope_text_except({ liste: liste(b.ohneTags) }) : "",
    b.ohneOrdnung ? m.scope_text_unsorted() : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function Auswahl({
  legende,
  hinweis,
  eintraege,
  gewaehlt,
  setzen,
}: {
  legende: string;
  hinweis: string;
  eintraege: { id: string; name: string }[];
  gewaehlt: string[];
  setzen: (ids: string[]) => void;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 rounded-md border border-border p-3">
      <legend className="px-1 font-medium text-sm">{legende}</legend>
      <p className="m-0 text-muted text-xs">{hinweis}</p>
      {eintraege.length === 0 && <p className="m-0 text-muted text-sm">{m.scope_none()}</p>}
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {eintraege.map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={gewaehlt.includes(e.id)}
              onChange={(ev) => setzen(ev.target.checked ? [...gewaehlt, e.id] : gewaehlt.filter((x) => x !== e.id))}
            />
            {e.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Recht und Sichtbereich eines Mitarbeiters wählen (Zugänge: einladen und ändern) */
export function ScopeEditor({ wert, aendern }: { wert: MitarbeiterWahl; aendern: (w: MitarbeiterWahl) => void }) {
  const namen = useNamen();
  const b = wert.sichtbereich;
  const setze = (teil: Partial<Sichtbereich>) => aendern({ ...wert, sichtbereich: { ...b, ...teil } });
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 self-start font-medium text-sm">
        {m.scope_right()}
        <select
          value={wert.recht}
          onChange={(e) => aendern({ ...wert, recht: e.target.value as Recht })}
          className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
        >
          <option value="lesen">{m.scope_right_read()}</option>
          <option value="bearbeiten">{m.scope_right_edit()}</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Auswahl
          legende={m.scope_tags()}
          hinweis={m.scope_any_hint()}
          eintraege={namen.tags}
          gewaehlt={b.tags}
          setzen={(tags) => setze({ tags })}
        />
        <Auswahl
          legende={m.scope_types()}
          hinweis={m.scope_any_hint()}
          eintraege={namen.typen}
          gewaehlt={b.dokumenttypen}
          setzen={(dokumenttypen) => setze({ dokumenttypen })}
        />
        <Auswahl
          legende={m.scope_parties()}
          hinweis={m.scope_any_hint()}
          eintraege={namen.korrespondenten}
          gewaehlt={b.korrespondenten}
          setzen={(korrespondenten) => setze({ korrespondenten })}
        />
        <Auswahl
          legende={m.scope_excluded()}
          hinweis={m.scope_excluded_hint()}
          eintraege={namen.tags}
          gewaehlt={b.ohneTags}
          setzen={(ohneTags) => setze({ ohneTags })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={b.ohneOrdnung}
          onChange={(e) => setze({ ohneOrdnung: e.target.checked })}
        />
        {m.scope_unsorted()}
      </label>
      <p className="m-0 text-muted text-sm">{sichtbereichText(b, namen.name)}</p>
    </div>
  );
}
