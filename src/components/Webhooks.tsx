import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { api, EREIGNISSE, type Ereignisart } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";
import { Einmalwert } from "./Einmalwert.tsx";

const ART: Record<Ereignisart, () => string> = {
  "dokument.aufgenommen": () => m.event_dokument_aufgenommen(),
  "dokument.eingeordnet": () => m.event_dokument_eingeordnet(),
  "dokument.geloescht": () => m.event_dokument_geloescht(),
  "dokument.workflow": () => m.event_dokument_workflow(),
};

/** Webhooks: anlegen (Geheimnis einmal), Liste mit Zustand, an- und abschalten; nur für den Inhaber */
export function Webhooks() {
  const id = useId();
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["webhooks"], queryFn: api.webhooks });
  const [geheimnis, setGeheimnis] = useState<string | null>(null);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["webhooks"] });
  const anlegen = useMutation({
    mutationFn: api.webhookAnlegen,
    onSuccess: async (w) => {
      setGeheimnis(w.geheimnis);
      await neu();
    },
  });
  const schalten = useMutation({
    mutationFn: ({ id, aktiv }: { id: string; aktiv: boolean }) => api.webhookSchalten(id, aktiv),
    onSuccess: neu,
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    anlegen.mutate({
      name: String(f.get("name") ?? ""),
      url: String(f.get("url") ?? ""),
      arten: f.getAll("arten").map(String) as Ereignisart[],
    });
  }

  return (
    <section aria-labelledby={`${id}-titel`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id={`${id}-titel`} className="m-0 font-semibold text-base">
        {m.webhooks_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.webhooks_intro()}</p>
      <form onSubmit={absenden} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.tokens_name()}
            <input name="name" required maxLength={200} className="h-9 rounded-md border border-border bg-bg px-3" />
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 font-medium text-sm">
            {m.webhooks_url()}
            <input
              name="url"
              type="url"
              required
              pattern="https?://.+"
              className="h-9 rounded-md border border-border bg-bg px-3"
            />
          </label>
        </div>
        <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0 text-sm">
          <legend className="mb-1.5 p-0 font-medium">{m.webhooks_events()}</legend>
          {EREIGNISSE.map((a) => (
            <label key={a} className="flex items-center gap-2">
              <input type="checkbox" name="arten" value={a} defaultChecked={a === "dokument.aufgenommen"} />
              {ART[a]()}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm">
          {m.webhooks_create()}
        </button>
      </form>
      {geheimnis && <Einmalwert label={m.webhooks_secret()} wert={geheimnis} />}
      {anlegen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {anlegen.error.message}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((w) => (
          <li
            key={w.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <span>
                <span className="font-medium">{w.name}</span> · <span className="break-all text-muted">{w.url}</span>
              </span>
              <span className="text-muted text-xs">
                {w.arten.map((a) => ART[a]()).join(", ")}
                {!w.aktiv && ` · ${m.webhooks_inactive()}`}
                {w.letzteZustellung && ` · ${m.webhooks_last({ datum: zeitpunkt(w.letzteZustellung) })}`}
              </span>
              {w.letzterFehler && (
                <span className="text-red-700 text-xs dark:text-red-400">
                  {m.webhooks_error({ fehler: w.letzterFehler })}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => schalten.mutate({ id: w.id, aktiv: !w.aktiv })}
              className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {w.aktiv ? m.webhooks_off() : m.webhooks_on()}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
