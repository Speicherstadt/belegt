import { useState } from "react";
import { ALGORITHMEN, type Algorithmus } from "../../shared/abgleich.ts";
import type { Abgleich } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

export const ALGORITHMUS_LABEL: Record<Algorithmus, () => string> = {
  keiner: () => m.match_none(),
  irgendein_wort: () => m.match_any(),
  alle_woerter: () => m.match_all(),
  exakt: () => m.match_literal(),
  regex: () => m.match_regex(),
  unscharf: () => m.match_fuzzy(),
  automatisch: () => m.match_auto(),
};

/** Kurzbeschreibung einer Regel für die Liste, etwa „Irgendein Wort: telekom magenta“ */
export function regelText(a: Abgleich): string {
  const name = ALGORITHMUS_LABEL[a.abgleich]();
  return a.abgleichText && a.abgleich !== "keiner" && a.abgleich !== "automatisch"
    ? `${name}: ${a.abgleichText}`
    : name;
}

/**
 * Felder einer Zuordnungsregel in einem Formular: Algorithmus, Text und Groß- und Kleinschreibung. Text und Häkchen
 * gibt es nur bei einem Algorithmus, der Text braucht.
 */
export function MatchingRule({ id, wert }: { id: string; wert?: Abgleich }) {
  const [algorithmus, setAlgorithmus] = useState<Algorithmus>(wert?.abgleich ?? "automatisch");
  const mitText = algorithmus !== "keiner" && algorithmus !== "automatisch";
  // Der Hinweis steht als eigene Zeile am Ende des Formulars: Im Fieldset machte er es höher als die Felder daneben,
  // und items-end der Formularzeile setzte Felder und Knöpfe darum versetzt
  return (
    <>
      <fieldset className="m-0 flex min-w-0 flex-wrap items-end gap-2 border-0 p-0">
        <legend className="sr-only">{m.match_legend()}</legend>
        <label htmlFor={`${id}-abgleich`} className="flex min-w-0 flex-col gap-1.5 font-medium">
          {m.match_label()}
          <select
            id={`${id}-abgleich`}
            name="abgleich"
            value={algorithmus}
            onChange={(e) => setAlgorithmus(e.target.value as Algorithmus)}
            aria-describedby={`${id}-hinweis`}
            className={feldKlasse}
          >
            {ALGORITHMEN.map((a) => (
              <option key={a} value={a}>
                {ALGORITHMUS_LABEL[a]()}
              </option>
            ))}
          </select>
        </label>
        {mitText && (
          <>
            <label htmlFor={`${id}-text`} className="flex min-w-0 flex-col gap-1.5 font-medium">
              {algorithmus === "regex" ? m.match_text_regex() : m.match_text()}
              <input
                id={`${id}-text`}
                name="abgleichText"
                required
                maxLength={500}
                defaultValue={wert?.abgleichText ?? ""}
                className={feldKlasse}
              />
            </label>
            <label className="flex h-9 items-center gap-2 font-normal">
              <input name="grossKleinEgal" type="checkbox" defaultChecked={wert?.grossKleinEgal ?? true} />
              {m.match_insensitive()}
            </label>
          </>
        )}
      </fieldset>
      <p id={`${id}-hinweis`} className="order-last m-0 basis-full text-muted text-xs">
        {algorithmus === "automatisch" ? m.match_auto_hint() : mitText ? m.match_hint() : m.match_none_hint()}
      </p>
    </>
  );
}

/** Die Regel aus einem Formular mit MatchingRule */
export function regelAus(f: FormData): Abgleich {
  const abgleich = String(f.get("abgleich") ?? "automatisch") as Algorithmus;
  const mitText = abgleich !== "keiner" && abgleich !== "automatisch";
  return {
    abgleich,
    abgleichText: mitText ? String(f.get("abgleichText") ?? "").trim() : "",
    grossKleinEgal: mitText ? f.get("grossKleinEgal") === "on" : true,
  };
}
