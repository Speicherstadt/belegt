import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader.tsx";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { rolleLabel } from "../lib/rollen.ts";
import { m } from "../paraglide/messages.js";

/** Zugänge: Konten, Einladungen anlegen und zurückziehen; nur für den Inhaber */
export function AccessPage() {
  const queryClient = useQueryClient();
  const daten = useQuery({ queryKey: ["zugaenge"], queryFn: api.zugaenge });
  const [rolle, setRolle] = useState<"steuerberatung" | "pruefer">("steuerberatung");
  const [link, setLink] = useState<string | null>(null);
  const einladen = useMutation({
    mutationFn: () => api.einladen(rolle),
    onSuccess: async (e) => {
      setLink(`${window.location.origin}${e.pfad}`);
      await queryClient.invalidateQueries({ queryKey: ["zugaenge"] });
    },
  });
  const zurueckziehen = useMutation({
    mutationFn: api.zurueckziehen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["zugaenge"] }),
  });

  function zustand(e: NonNullable<typeof daten.data>["einladungen"][number]): string {
    if (e.eingeloestAm) return m.access_state_used({ email: e.eingeloestVon ?? "" });
    if (e.zurueckgezogenAm) return m.access_state_revoked();
    if (new Date(e.gueltigBis) < new Date()) return m.access_state_expired();
    return m.access_state_open({ datum: zeitpunkt(e.gueltigBis) });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={m.access_title()} intro={m.access_intro()} />
      <section aria-labelledby="konten" className="flex flex-col gap-2">
        <h2 id="konten" className="m-0 font-semibold text-base">
          {m.access_users()}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {daten.data?.zugaenge.map((z) => (
            <li key={z.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border p-3 text-sm">
              <span className="font-medium">{z.email}</span>
              <span className="text-muted">{rolleLabel(z.rolle)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="einladungen" className="flex flex-col gap-3">
        <h2 id="einladungen" className="m-0 font-semibold text-base">
          {m.access_invites()}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.access_role()}
            <select
              value={rolle}
              onChange={(e) => setRolle(e.target.value as typeof rolle)}
              className="h-9 rounded-md border border-border bg-bg px-3 font-normal"
            >
              <option value="steuerberatung">{m.role_steuerberatung()}</option>
              <option value="pruefer">{m.role_pruefer()}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => einladen.mutate()}
            className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm"
          >
            {m.access_invite()}
          </button>
        </div>
        {link && (
          <p role="status" className="m-0 flex flex-col gap-1 rounded-md border border-border bg-subtle p-3 text-sm">
            {m.access_link()}
            <code className="break-all">{link}</code>
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {daten.data?.einladungen.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <span>
                <span className="font-medium">{rolleLabel(e.rolle)}</span> ·{" "}
                <span className="text-muted">{zustand(e)}</span>
              </span>
              {!e.eingeloestAm && !e.zurueckgezogenAm && new Date(e.gueltigBis) > new Date() && (
                <button
                  type="button"
                  onClick={() => zurueckziehen.mutate(e.id)}
                  className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
                >
                  {m.access_revoke()}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
