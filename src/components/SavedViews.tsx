import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, type GespeicherteAnsicht } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

const knopf = "h-8 rounded-md border border-border px-2.5 font-medium text-sm hover:bg-subtle disabled:opacity-60";

/** Eigene gespeicherte Ansichten umbenennen, ordnen und löschen; für alle freigegebene anderer bleiben, wie sie sind */
export function SavedViews({ ansichten }: { ansichten: GespeicherteAnsicht[] }) {
  const queryClient = useQueryClient();
  const eigene = ansichten.filter((a) => a.eigene);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["ansichten"] });
  const ordnen = useMutation({ mutationFn: api.ansichtenOrdnen, onSuccess: neu });
  const loeschen = useMutation({ mutationFn: api.ansichtLoeschen, onSuccess: neu });
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const umbenennen = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.ansichtAendern(id, { name }),
    onSuccess: () => {
      setBearbeitet(null);
      void neu();
    },
  });
  const verschieben = (i: number, um: -1 | 1) => {
    const ids = eigene.map((a) => a.id);
    [ids[i], ids[i + um]] = [ids[i + um]!, ids[i]!];
    ordnen.mutate(ids);
  };
  const fehler = ordnen.error ?? loeschen.error ?? umbenennen.error;

  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">{m.views_manage()}</summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {eigene.map((a, i) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            {bearbeitet === a.id ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  umbenennen.mutate({ id: a.id, name: String(new FormData(e.currentTarget).get("name") ?? "") });
                }}
              >
                <label className="flex items-center gap-2">
                  <span className="sr-only">{m.views_name()}</span>
                  <input name="name" defaultValue={a.name} required maxLength={100} className={feldKlasse} />
                </label>
                <button type="submit" className={knopf} disabled={umbenennen.isPending}>
                  {m.views_save_confirm()}
                </button>
              </form>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {a.name}
                {a.fuerAlle && <span className="ml-2 text-muted">({m.views_shared()})</span>}
              </span>
            )}
            {bearbeitet !== a.id && (
              <button
                type="button"
                className={knopf}
                onClick={() => setBearbeitet(a.id)}
                aria-label={m.views_rename({ name: a.name })}
              >
                {m.views_rename_short()}
              </button>
            )}
            <button
              type="button"
              className={knopf}
              disabled={i === 0 || ordnen.isPending}
              onClick={() => verschieben(i, -1)}
              aria-label={m.views_up({ name: a.name })}
            >
              ↑
            </button>
            <button
              type="button"
              className={knopf}
              disabled={i === eigene.length - 1 || ordnen.isPending}
              onClick={() => verschieben(i, 1)}
              aria-label={m.views_down({ name: a.name })}
            >
              ↓
            </button>
            <button
              type="button"
              className={knopf}
              disabled={loeschen.isPending}
              onClick={() => loeschen.mutate(a.id)}
              aria-label={m.views_delete({ name: a.name })}
            >
              {m.views_delete_short()}
            </button>
          </li>
        ))}
      </ul>
      {fehler && (
        <p role="alert" className="m-0 mt-2 text-red-700 dark:text-red-400">
          {fehler.message}
        </p>
      )}
    </details>
  );
}
