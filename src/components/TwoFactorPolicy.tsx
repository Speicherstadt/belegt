import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ROLLEN, type Rolle } from "../../shared/rollen.ts";
import { api } from "../lib/api.ts";
import { rolleLabel } from "../lib/rollen.ts";
import { m } from "../paraglide/messages.js";

/** Für welche Rollen ein zweiter Faktor Pflicht ist; auf der Seite Zugänge, nur für den Inhaber */
export function TwoFactorPolicy() {
  const queryClient = useQueryClient();
  const pflicht = useQuery({ queryKey: ["zwei-faktor"], queryFn: api.zweiFaktorPflicht });
  const [rollen, setRollen] = useState<Rolle[]>([]);
  useEffect(() => {
    if (pflicht.data) setRollen(pflicht.data.pflicht);
  }, [pflicht.data]);
  const speichern = useMutation({
    mutationFn: () => api.zweiFaktorPflichtSetzen(rollen),
    // Gilt die Pflicht jetzt für den Inhaber selbst, schickt ihn die Shell zur Einrichtung
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <section aria-labelledby="zwei-faktor-pflicht" className="flex flex-col gap-3">
      <h2 id="zwei-faktor-pflicht" className="m-0 font-semibold text-base">
        {m.access_2fa_policy()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.access_2fa_policy_intro()}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          speichern.mutate();
        }}
        className="flex flex-col gap-3"
      >
        <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
          <legend className="sr-only">{m.access_2fa_policy()}</legend>
          {ROLLEN.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rollen.includes(r)}
                onChange={(e) => setRollen(e.target.checked ? [...rollen, r] : rollen.filter((x) => x !== r))}
              />
              {rolleLabel(r)}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={speichern.isPending || !pflicht.data}
          className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
        >
          {m.access_save()}
        </button>
        {speichern.isSuccess && (
          <p role="status" className="m-0 text-sm">
            {m.access_2fa_policy_saved()}
          </p>
        )}
        {speichern.error && (
          <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
            {speichern.error.message}
          </p>
        )}
      </form>
    </section>
  );
}
