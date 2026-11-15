import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Ich } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

/**
 * Notizen zu einem Dokument: Inhaber und Steuerberatung lesen und schreiben, Prüfer sehen sie nicht. Eine Notiz lässt
 * sich nicht ändern; zurückziehen blendet sie aus, der Verlauf behält es (docs/dokument.md#notizen).
 */
export function Notes({ dokumentId, ich, geloescht }: { dokumentId: string; ich: Ich; geloescht: boolean }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const notizen = useQuery({ queryKey: ["notizen", dokumentId], queryFn: () => api.notizen(dokumentId) });
  const neu = () => {
    void queryClient.invalidateQueries({ queryKey: ["notizen", dokumentId] });
    void queryClient.invalidateQueries({ queryKey: ["verlauf", dokumentId] });
  };
  const anlegen = useMutation({
    mutationFn: () => api.notizAnlegen(dokumentId, text),
    onSuccess: () => {
      setText("");
      neu();
    },
  });
  const zurueckziehen = useMutation({
    mutationFn: (notiz: string) => api.notizZurueckziehen(dokumentId, notiz),
    onSuccess: neu,
  });
  const ich_ = `nutzer:${ich.email}`;
  const fehler = anlegen.error ?? zurueckziehen.error;
  if (geloescht && !notizen.data?.length) return null;

  return (
    <section aria-labelledby="notizen" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="notizen" className="m-0 font-semibold text-base">
        {m.notes_title()}
      </h2>
      {notizen.data?.length === 0 && <p className="m-0 text-muted text-sm">{m.notes_empty()}</p>}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {notizen.data?.map((n) => (
          <li key={n.id} className="flex flex-col gap-1 text-sm">
            <p className="m-0 whitespace-pre-wrap break-words">{n.text}</p>
            <span className="flex flex-wrap items-center gap-2 text-muted text-xs">
              {zeitpunkt(n.erstelltAm)} · {n.erstelltVon}
              {(ich.role === "inhaber" || n.erstelltVon === ich_) && (
                <button
                  type="button"
                  onClick={() => zurueckziehen.mutate(n.id)}
                  className="underline underline-offset-2 hover:text-fg"
                >
                  {m.notes_withdraw()}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {!geloescht && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) anlegen.mutate();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {m.notes_new()}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={5000}
              rows={3}
              className="rounded-md border border-border bg-transparent p-2"
            />
          </label>
          <p className="m-0 text-muted text-xs">{m.notes_hint()}</p>
          <button
            type="submit"
            disabled={!text.trim() || anlegen.isPending}
            className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60"
          >
            {m.notes_add()}
          </button>
        </form>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {fehler.message}
        </p>
      )}
    </section>
  );
}
