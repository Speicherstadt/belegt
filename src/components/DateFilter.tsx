import { DATUMSARTEN, ZEITRAEUME, type Zeitraum } from "../../shared/zeitraum.ts";
import type { ListenFilter } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

const ZEITRAUM_LABEL: Record<Zeitraum, () => string> = {
  "": () => m.date_filter_any(),
  "7t": () => m.date_filter_7d(),
  "30t": () => m.date_filter_30d(),
  jahr: () => m.date_filter_year(),
  vorjahr: () => m.date_filter_last_year(),
  eigen: () => m.date_filter_custom(),
};

/**
 * Datumsfilter der Archivliste: Tag der Entstehung oder des Eingangs, Schnellwahl oder eigener Zeitraum. Die Felder
 * für eigene Tage erscheinen erst beim eigenen Zeitraum, die Art erst mit einem Zeitraum
 */
export function DateFilter({ filter, onChange }: { filter: ListenFilter; onChange: (f: ListenFilter) => void }) {
  return (
    <fieldset className="m-0 flex flex-wrap items-end gap-3 border-0 p-0 text-sm">
      <legend className="sr-only">{m.date_filter_legend()}</legend>
      <label className="flex flex-col gap-1.5 font-medium">
        {m.date_filter_period()}
        <select
          value={filter.zeitraum}
          onChange={(e) => onChange({ ...filter, zeitraum: e.target.value as Zeitraum })}
          className={feldKlasse}
        >
          {ZEITRAEUME.map((z) => (
            <option key={z} value={z}>
              {ZEITRAUM_LABEL[z]()}
            </option>
          ))}
        </select>
      </label>
      {filter.zeitraum && (
        <label className="flex flex-col gap-1.5 font-medium">
          {m.date_filter_kind()}
          <select
            value={filter.datumArt}
            onChange={(e) => onChange({ ...filter, datumArt: e.target.value as ListenFilter["datumArt"] })}
            className={feldKlasse}
          >
            {DATUMSARTEN.map((a) => (
              <option key={a} value={a}>
                {a === "entstanden" ? m.date_filter_created() : m.date_filter_received()}
              </option>
            ))}
          </select>
        </label>
      )}
      {filter.zeitraum === "eigen" &&
        (["datumVon", "datumBis"] as const).map((grenze) => (
          <label key={grenze} className="flex flex-col gap-1.5 font-medium">
            {grenze === "datumVon" ? m.filter_from() : m.filter_to()}
            <input
              type="date"
              value={filter[grenze]}
              max={grenze === "datumVon" ? filter.datumBis || undefined : undefined}
              min={grenze === "datumBis" ? filter.datumVon || undefined : undefined}
              onChange={(e) => onChange({ ...filter, [grenze]: e.target.value })}
              className={feldKlasse}
            />
          </label>
        ))}
    </fieldset>
  );
}
