import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { Ausklappbar, verwaltungsKarte } from "./Ausklappbar.tsx";
import { feldKlasse } from "./FieldInput.tsx";

/**
 * Eigene Fristvorlagen, etwa „Garantie, 24 Monate“: Beim Einordnen als „freiwillig mit Frist“ füllen sie das Fristende
 * aus. Gesetzliche Fristen bleiben davon unberührt; anlegen und löschen darf der Inhaber
 */
export function RetentionTemplates() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["fristvorlagen"], queryFn: api.fristvorlagen });
  const [offen, setOffen] = useState(false);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["fristvorlagen"] });
  const anlegen = useMutation({ mutationFn: api.fristvorlageAnlegen, onSuccess: neu });
  const loeschen = useMutation({ mutationFn: api.fristvorlageLoeschen, onSuccess: neu });
  const schreiben = darfSchreiben(ich.data?.role);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate(
      { name: String(f.get("name") ?? "").trim(), monate: Number(f.get("monate")) },
      {
        onSuccess: () => {
          form.reset();
          setOffen(false);
        },
      },
    );
  }

  return (
    <section aria-labelledby="fristvorlagen" className={verwaltungsKarte}>
      <h2 id="fristvorlagen" className="m-0 font-semibold text-base">
        {m.templates_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.templates_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.templates_none()}</p>}
      {!!liste.data?.length && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {liste.data.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <span>
                <span className="font-medium">{v.name}</span>{" "}
                <span className="text-muted">{m.templates_months({ monate: String(v.monate) })}</span>
              </span>
              {schreiben && (
                <button
                  type="button"
                  onClick={() => loeschen.mutate(v.id)}
                  aria-label={m.templates_delete({ name: v.name })}
                  className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
                >
                  {m.order_delete()}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {schreiben && (
        <Ausklappbar label={m.templates_create()} offen={offen} setOffen={setOffen}>
          <form onSubmit={absenden} className="grid items-end gap-3 text-sm sm:grid-cols-[1fr_10rem_auto]">
            <label className="flex flex-col gap-1.5 font-medium">
              {m.templates_name()}
              <input
                name="name"
                required
                maxLength={100}
                placeholder={m.templates_name_example()}
                className={feldKlasse}
              />
            </label>
            <label className="flex flex-col gap-1.5 font-medium">
              {m.templates_duration()}
              <input name="monate" type="number" required min={1} max={1200} className={feldKlasse} />
            </label>
            <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
              {m.templates_create()}
            </button>
          </form>
        </Ausklappbar>
      )}
      {(anlegen.error ?? loeschen.error) && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {(anlegen.error ?? loeschen.error)!.message}
        </p>
      )}
    </section>
  );
}
