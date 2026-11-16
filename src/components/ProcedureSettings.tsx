import { ANGABE_NAMEN, ANGABEN_FELDER, type AngabeName } from "@firsttris/gobd-kern/verfahrensdoku";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId } from "react";
import { api, type Einstellungen } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const feld = "rounded-md border border-border bg-bg px-3 py-2 font-normal text-sm";

/** Beschriftung mit Hinweis je Angabe zum Betrieb; Höchstlänge und Art des Felds kommen aus dem Schema des GoBD-Kerns */
const LABEL: Record<AngabeName, () => string> = {
  firma: m.procedure_firm,
  rechtsform: m.procedure_legal_form,
  anschrift: m.procedure_address,
  verantwortlich: m.procedure_responsible,
  aufbewahrungsort: m.procedure_storage_location,
  serverbetrieb: m.procedure_server,
  datensicherung: m.procedure_backup,
  schluesselablage: m.procedure_keys,
  papierbelege: m.procedure_scan,
  ergaenzungen: m.procedure_extra,
};

/** Was nur der Betrieb wissen kann; der Inhaber ändert es, alle anderen lesen */
export function ProcedureSettings({ werte, darfAendern }: { werte: Einstellungen; darfAendern: boolean }) {
  const queryClient = useQueryClient();
  const id = useId();
  const speichern = useMutation({
    mutationFn: async (e: Einstellungen) => {
      const neu = await api.einstellungenSpeichern(e);
      queryClient.setQueryData(["einstellungen"], neu);
      return neu;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["verfahrensdoku"] }),
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const angaben = Object.fromEntries(ANGABE_NAMEN.map((name) => [name, String(f.get(name) ?? "")]));
    speichern.mutate({ ...(angaben as Omit<Einstellungen, "aufsicht">), aufsicht: f.get("aufsicht") === "on" });
  }

  const textfeld = (name: AngabeName) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${name}`} className="font-medium text-sm">
        {LABEL[name]()}
      </label>
      {ANGABEN_FELDER[name].mehrzeilig ? (
        <textarea
          id={`${id}-${name}`}
          name={name}
          defaultValue={werte[name]}
          maxLength={ANGABEN_FELDER[name].max}
          rows={3}
          disabled={!darfAendern}
          className={feld}
        />
      ) : (
        <input
          id={`${id}-${name}`}
          name={name}
          defaultValue={werte[name]}
          maxLength={ANGABEN_FELDER[name].max}
          disabled={!darfAendern}
          className={`h-9 ${feld}`}
        />
      )}
    </div>
  );

  return (
    <section
      aria-labelledby={`${id}-titel`}
      className="flex flex-col gap-3 rounded-lg border border-border p-4 print:hidden"
    >
      <h2 id={`${id}-titel`} className="m-0 font-semibold text-base">
        {m.procedure_settings()}
      </h2>
      <form onSubmit={absenden} className="flex flex-col gap-3">
        {textfeld("firma")}
        {textfeld("rechtsform")}
        {textfeld("anschrift")}
        {textfeld("verantwortlich")}
        {textfeld("aufbewahrungsort")}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="aufsicht"
            defaultChecked={werte.aufsicht}
            disabled={!darfAendern}
            className="mt-0.5"
          />
          {m.procedure_supervision()}
        </label>
        {textfeld("serverbetrieb")}
        {textfeld("datensicherung")}
        {textfeld("schluesselablage")}
        {textfeld("papierbelege")}
        {textfeld("ergaenzungen")}
        {darfAendern && (
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={speichern.isPending}
              className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
            >
              {m.procedure_save()}
            </button>
            {speichern.isSuccess && (
              <p role="status" className="m-0 text-sm">
                {m.procedure_saved()}
              </p>
            )}
            {speichern.error && (
              <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
                {speichern.error.message}
              </p>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
