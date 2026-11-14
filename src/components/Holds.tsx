import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { api } from "../lib/api.ts";
import { tag, zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Sperren (Legal Hold): Liste, anlegen und aufheben */
export function Holds() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["sperren"], queryFn: api.sperren });
  const neu = async () => queryClient.invalidateQueries();
  const anlegen = useMutation({ mutationFn: api.sperreAnlegen, onSuccess: neu });
  const aufheben = useMutation({ mutationFn: api.sperreAufheben, onSuccess: neu });
  const schreiben = darfSchreiben(ich.data?.role);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate(
      { grund: String(f.get("grund")), von: String(f.get("von")), bis: String(f.get("bis")) },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section aria-labelledby="sperren" className="flex flex-col gap-3">
      <h2 id="sperren" className="m-0 font-semibold text-base">
        {m.holds_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.holds_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.holds_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">{s.grund}</span>
              <span className="text-muted">
                {tag(s.von)} – {tag(s.bis)} ·{" "}
                {s.aufgehobenAm ? m.holds_released({ datum: zeitpunkt(s.aufgehobenAm) }) : m.holds_active()}
              </span>
            </div>
            {schreiben && !s.aufgehobenAm && (
              <button
                type="button"
                onClick={() => aufheben.mutate(s.id)}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
              >
                {m.holds_release()}
              </button>
            )}
          </li>
        ))}
      </ul>
      {schreiben && (
        <form onSubmit={absenden} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <label className="flex min-w-48 flex-[2_1_200px] flex-col gap-1.5 font-medium text-sm">
            {m.holds_reason()}
            <input name="grund" required className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.holds_from()}
            <input name="von" type="date" required className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.holds_to()}
            <input name="bis" type="date" required className={feld} />
          </label>
          <button
            type="submit"
            disabled={anlegen.isPending}
            className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
          >
            {m.holds_create()}
          </button>
        </form>
      )}
      {(anlegen.error ?? aufheben.error) && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.holds_failed({ meldung: (anlegen.error ?? aufheben.error)!.message })}
        </p>
      )}
    </section>
  );
}
