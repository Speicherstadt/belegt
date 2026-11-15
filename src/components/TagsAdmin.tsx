import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FARBNAMEN, type Farbe } from "../../shared/ordnung.ts";
import { api, type Tag } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";
import { MatchingRule, regelAus, regelText } from "./MatchingRule.tsx";
import { TagChip } from "./TagChip.tsx";

export const FARBE_LABEL: Record<Farbe, () => string> = {
  grau: () => m.color_gray(),
  rot: () => m.color_red(),
  orange: () => m.color_orange(),
  gelb: () => m.color_yellow(),
  gruen: () => m.color_green(),
  tuerkis: () => m.color_teal(),
  blau: () => m.color_blue(),
  violett: () => m.color_violet(),
  rosa: () => m.color_pink(),
};

function FarbAuswahl({ id, name, wert }: { id: string; name: string; wert?: Farbe }) {
  return (
    <select id={id} name={name} defaultValue={wert ?? "grau"} className={feldKlasse}>
      {FARBNAMEN.map((f) => (
        <option key={f} value={f}>
          {FARBE_LABEL[f]()}
        </option>
      ))}
    </select>
  );
}

/** Ein Tag in der Liste: anzeigen, umbenennen, Farbe wechseln, löschen (mit Rückfrage) */
function TagZeile({ tag, schreiben }: { tag: Tag; schreiben: boolean }) {
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [loeschen, setLoeschen] = useState(false);
  const neu = () => queryClient.invalidateQueries();
  const aendern = useMutation({
    mutationFn: (t: Parameters<typeof api.tagAendern>[1]) => api.tagAendern(tag.id, t),
    onSuccess: () => {
      setBearbeiten(false);
      return neu();
    },
  });
  const weg = useMutation({ mutationFn: () => api.tagLoeschen(tag.id), onSuccess: neu });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    aendern.mutate({ name: String(f.get("name")), farbe: String(f.get("farbe")) as Farbe, ...regelAus(f) });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <TagChip tag={tag} />
          <span className="text-muted">
            {m.order_count({ anzahl: String(tag.anzahl) })} · {regelText(tag)}
          </span>
        </span>
        {schreiben && (
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={bearbeiten}
              aria-label={m.order_edit_named({ name: tag.name })}
              onClick={() => setBearbeiten(!bearbeiten)}
              className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {m.order_edit()}
            </button>
            {loeschen ? (
              <button
                type="button"
                onClick={() => weg.mutate()}
                className="h-8 rounded-md bg-red-700 px-3 font-medium text-white"
              >
                {m.order_delete_confirm({ name: tag.name })}
              </button>
            ) : (
              <button
                type="button"
                aria-label={m.order_delete_named({ name: tag.name })}
                onClick={() => setLoeschen(true)}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
              >
                {m.order_delete()}
              </button>
            )}
          </span>
        )}
      </div>
      {bearbeiten && (
        <form onSubmit={absenden} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_name()}
            <input name="name" required maxLength={100} defaultValue={tag.name} className={feldKlasse} />
          </label>
          <label htmlFor={`farbe-${tag.id}`} className="flex flex-col gap-1.5 font-medium">
            {m.order_color()}
            <FarbAuswahl id={`farbe-${tag.id}`} name="farbe" wert={tag.farbe} />
          </label>
          <MatchingRule id={`regel-${tag.id}`} wert={tag} />
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.save()}
          </button>
        </form>
      )}
      {(aendern.error ?? weg.error) && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {m.order_failed({ meldung: (aendern.error ?? weg.error)!.message })}
        </p>
      )}
    </li>
  );
}

/** Tags: Liste mit Anzahl der Dokumente, anlegen, ändern und löschen (löschen entfernt nur die Zuordnungen) */
export function TagsAdmin({ schreiben }: { schreiben: boolean }) {
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const anlegen = useMutation({ mutationFn: api.tagAnlegen, onSuccess: () => queryClient.invalidateQueries() });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate(
      { name: String(f.get("name")), farbe: String(f.get("farbe")) as Farbe },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section aria-labelledby="tags" className="flex flex-col gap-3">
      <h2 id="tags" className="m-0 font-semibold text-base">
        {m.order_tags()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.order_tags_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.order_tags_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((t) => (
          <TagZeile key={t.id} tag={t} schreiben={schreiben} />
        ))}
      </ul>
      {schreiben && (
        <form
          onSubmit={absenden}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_tag_name()}
            <input name="name" required maxLength={100} className={feldKlasse} />
          </label>
          <label htmlFor="farbe-neu" className="flex flex-col gap-1.5 font-medium">
            {m.order_color()}
            <FarbAuswahl id="farbe-neu" name="farbe" />
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.order_tag_create()}
          </button>
        </form>
      )}
      {anlegen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.order_failed({ meldung: anlegen.error.message })}
        </p>
      )}
    </section>
  );
}
