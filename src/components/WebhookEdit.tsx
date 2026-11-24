import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useRef, useState } from "react";
import { ApiFehler, api, EREIGNISSE, type Ereignisart, type Webhook, type WebhookAenderung } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const ART: Record<Ereignisart, () => string> = {
  "dokument.aufgenommen": () => m.event_dokument_aufgenommen(),
  "dokument.eingeordnet": () => m.event_dokument_eingeordnet(),
  "dokument.geloescht": () => m.event_dokument_geloescht(),
  "dokument.workflow": () => m.event_dokument_workflow(),
};

/** Nur Geändertes; das Geheimnis bleibt und wird nicht neu ausgegeben */
export function webhookAenderung(w: Webhook, f: FormData): WebhookAenderung {
  const neu: WebhookAenderung = {
    name: String(f.get("name") ?? ""),
    url: String(f.get("url") ?? ""),
    arten: f.getAll("arten").map(String) as Ereignisart[],
  };
  const gleich = (k: keyof WebhookAenderung) => JSON.stringify(w[k]) === JSON.stringify(neu[k]);
  return Object.fromEntries(Object.entries(neu).filter(([k]) => !gleich(k as keyof WebhookAenderung)));
}

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

export function WebhookEditForm({ webhook, fertig, id }: { webhook: Webhook; fertig: () => void; id?: string }) {
  const queryClient = useQueryClient();
  const speichern = useMutation({
    mutationFn: (e: WebhookAenderung) => api.webhookAendern(webhook.id, e),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      fertig();
    },
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const aenderung = webhookAenderung(webhook, new FormData(e.currentTarget));
    if (Object.keys(aenderung).length === 0) fertig();
    else speichern.mutate(aenderung);
  }

  return (
    <form id={id} onSubmit={absenden} className="flex w-full flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 font-medium">
          {m.tokens_name()}
          <input name="name" required maxLength={200} defaultValue={webhook.name} className={feld} />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1.5 font-medium">
          {m.webhooks_url()}
          <input name="url" type="url" required pattern="https?://.+" defaultValue={webhook.url} className={feld} />
        </label>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-1.5 p-0 font-medium">{m.webhooks_events()}</legend>
        {EREIGNISSE.map((a) => (
          <label key={a} className="flex items-center gap-2">
            <input type="checkbox" name="arten" value={a} defaultChecked={webhook.arten.includes(a)} />
            {ART[a]()}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={fertig}
          disabled={speichern.isPending}
          className="h-9 rounded-md border border-border px-3 font-medium disabled:opacity-60"
        >
          {m.confirm_cancel()}
        </button>
        <button
          type="submit"
          disabled={speichern.isPending}
          className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
        >
          {m.save()}
        </button>
      </div>
      {speichern.error && (
        <p role="alert" className="m-0 text-danger">
          {speichern.error.message}
        </p>
      )}
    </form>
  );
}

/** „Entfernen“ und „Ändern“ eines Webhooks, mit Rückfrage vor dem Entfernen */
export function WebhookEdit({
  webhook,
  inhaber,
  nachEntfernen,
}: {
  webhook: Webhook;
  inhaber: boolean;
  /** Der Eintrag ist danach weg; der Elternteil setzt den Fokus an eine sinnvolle Stelle */
  nachEntfernen?: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [fragen, setFragen] = useState(false);
  const aendern = useRef<HTMLButtonElement>(null);
  const entfernen = useMutation({
    mutationFn: () => api.webhookEntfernen(webhook.id),
    onSuccess: async () => {
      setFragen(false);
      await queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      nachEntfernen?.();
    },
  });
  const schliessen = () => {
    setBearbeiten(false);
    aendern.current?.focus();
  };
  if (!inhaber) return null;

  const fehler = entfernen.error
    ? entfernen.error instanceof ApiFehler && entfernen.error.status === 409
      ? m.webhooks_remove_blocked({ meldung: entfernen.error.message })
      : entfernen.error.message
    : undefined;

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFragen(true)}
          aria-label={m.webhooks_remove_named({ name: webhook.name })}
          className="h-8 rounded-md border border-danger px-3 font-medium text-danger hover:bg-subtle"
        >
          {m.webhooks_remove()}
        </button>
        <button
          ref={aendern}
          type="button"
          onClick={() => setBearbeiten(true)}
          aria-expanded={bearbeiten}
          aria-controls={bearbeiten ? formId : undefined}
          aria-label={m.webhooks_edit_named({ name: webhook.name })}
          className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
        >
          {m.webhooks_edit()}
        </button>
      </div>
      {bearbeiten && <WebhookEditForm id={formId} webhook={webhook} fertig={schliessen} />}
      <ConfirmDialog
        open={fragen}
        titel={m.webhooks_remove_title({ name: webhook.name })}
        folge={m.webhooks_remove_follow()}
        verb={m.webhooks_remove()}
        pending={entfernen.isPending}
        fehler={fehler}
        onConfirm={() => entfernen.mutate()}
        onCancel={() => {
          setFragen(false);
          entfernen.reset();
        }}
      />
    </div>
  );
}
