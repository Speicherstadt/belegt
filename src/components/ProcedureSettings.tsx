import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId } from "react";
import { api, type Einstellungen } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

const feld = "rounded-md border border-border bg-bg px-3 py-2 font-normal text-sm";

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
    const text = (name: string) => String(f.get(name) ?? "");
    speichern.mutate({
      firma: text("firma"),
      anschrift: text("anschrift"),
      verantwortlich: text("verantwortlich"),
      aufsicht: f.get("aufsicht") === "on",
      datensicherung: text("datensicherung"),
      scannen: text("scannen"),
      ergaenzungen: text("ergaenzungen"),
    });
  }

  const textfeld = (name: keyof Einstellungen, label: string, mehrzeilig = false) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${name}`} className="font-medium text-sm">
        {label}
      </label>
      {mehrzeilig ? (
        <textarea
          id={`${id}-${name}`}
          name={name}
          defaultValue={String(werte[name])}
          rows={3}
          disabled={!darfAendern}
          className={feld}
        />
      ) : (
        <input
          id={`${id}-${name}`}
          name={name}
          defaultValue={String(werte[name])}
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
        {textfeld("firma", m.procedure_firm())}
        {textfeld("anschrift", m.procedure_address())}
        {textfeld("verantwortlich", m.procedure_responsible())}
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
        {textfeld("datensicherung", m.procedure_backup(), true)}
        {textfeld("scannen", m.procedure_scan(), true)}
        {textfeld("ergaenzungen", m.procedure_extra(), true)}
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
