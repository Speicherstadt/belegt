import type { ReactNode } from "react";
import { m } from "../../paraglide/messages.js";
import { feldKlasse } from "../FieldInput.tsx";

export interface Zeile {
  schluessel: string;
  label: string;
  /** Das Eingabefeld; es trägt die übergebene id, damit das Label dazu gehört */
  feld: (id: string) => ReactNode;
}

/**
 * Bedingungen oder Aktionen eines Workflows, die man einzeln hinzufügt statt alle leeren Felder auf einmal zu sehen.
 * Was nicht hinzugefügt ist, steht nicht im Formular und fällt so beim Speichern weg.
 */
export function AddableRows({
  zeilen,
  gewaehlt,
  setGewaehlt,
  auswahlLabel,
  leer,
}: {
  zeilen: Zeile[];
  gewaehlt: string[];
  setGewaehlt: (s: string[]) => void;
  auswahlLabel: string;
  leer: string;
}) {
  const offen = zeilen.filter((z) => !gewaehlt.includes(z.schluessel));
  const gezeigt = gewaehlt.map((s) => zeilen.find((z) => z.schluessel === s)).filter((z) => z !== undefined);
  return (
    <div className="flex flex-col gap-3">
      {gezeigt.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {gezeigt.map((z) => {
            const id = `workflow-${z.schluessel}`;
            return (
              <li
                key={z.schluessel}
                className="grid grid-cols-1 items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[12rem_1fr_auto]"
              >
                <label htmlFor={id} className="font-medium">
                  {z.label}
                </label>
                <div className="flex min-w-0 flex-col [&>*]:w-full">{z.feld(id)}</div>
                <button
                  type="button"
                  onClick={() => setGewaehlt(gewaehlt.filter((s) => s !== z.schluessel))}
                  aria-label={m.workflow_remove_row({ name: z.label })}
                  className="size-9 justify-self-end rounded-md text-lg text-muted hover:bg-subtle hover:text-fg"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-muted">{leer}</p>
      )}
      {!!offen.length && (
        <select
          aria-label={auswahlLabel}
          value=""
          onChange={(e) => e.target.value && setGewaehlt([...gewaehlt, e.target.value])}
          className={`${feldKlasse} self-start`}
        >
          <option value="">+ {auswahlLabel}</option>
          {offen.map((z) => (
            <option key={z.schluessel} value={z.schluessel}>
              {z.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
