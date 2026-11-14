import { useSyncExternalStore } from "react";
import { MODI, MODUS_VORGABE, type Modus, modusAbonnieren, modusLesen, modusSpeichern } from "../lib/darstellung.ts";
import { m } from "../paraglide/messages.js";

const NAMEN: Record<Modus, () => string> = {
  system: () => m.theme_system(),
  hell: () => m.theme_light(),
  dunkel: () => m.theme_dark(),
};

/** Hell, dunkel oder nach dem Gerät; drei Optionsfelder, als ein Schalter gezeichnet */
export function Darstellung() {
  const modus = useSyncExternalStore(
    modusAbonnieren,
    () => modusLesen(),
    () => MODUS_VORGABE,
  );
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-muted text-xs">{m.theme_label()}</legend>
      <div className="flex rounded-md border border-border p-0.5">
        {MODI.map((mo) => (
          <label
            key={mo}
            className="flex h-7 flex-1 cursor-pointer items-center justify-center rounded px-2 text-fg/80 text-xs has-checked:bg-subtle has-checked:font-medium has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-primary"
          >
            <input
              type="radio"
              name="darstellung"
              value={mo}
              checked={modus === mo}
              onChange={() => modusSpeichern(mo)}
              className="sr-only"
            />
            {NAMEN[mo]()}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
