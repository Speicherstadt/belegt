import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  type ArchivAnsicht,
  ansichtZuParametern,
  PRO_SEITE_WAHL,
  SORTIERUNGEN,
  type Sortierung,
} from "../../shared/archivansicht.ts";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";
import { SavedViews } from "./SavedViews.tsx";

export const SORTIERUNG_LABEL: Record<Sortierung, () => string> = {
  neu: () => m.sort_newest(),
  alt: () => m.sort_oldest(),
  titel: () => m.sort_title(),
  entstanden: () => m.sort_created(),
  frist: () => m.sort_retention(),
};

const gleich = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** Sortierung, Einträge je Seite und die gespeicherten Ansichten unter den Filtern des Archivs */
export function ListOptions({
  ansicht,
  setAnsicht,
}: {
  ansicht: ArchivAnsicht;
  setAnsicht: (a: ArchivAnsicht) => void;
}) {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const ansichten = useQuery({ queryKey: ["ansichten"], queryFn: api.ansichten });
  const [speichern, setSpeichern] = useState(false);
  const anlegen = useMutation({
    mutationFn: api.ansichtAnlegen,
    onSuccess: () => {
      setSpeichern(false);
      void queryClient.invalidateQueries({ queryKey: ["ansichten"] });
    },
  });
  const parameter = ansichtZuParametern(ansicht);
  const aktuelle = ansichten.data?.find((a) => gleich(a.parameter, parameter));

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    anlegen.mutate({ name: String(f.get("name") ?? ""), parameter, fuerAlle: f.get("fuerAlle") === "on" });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1.5 font-medium">
          {m.sort_label()}
          <select
            value={ansicht.sortierung}
            onChange={(e) => setAnsicht({ ...ansicht, sortierung: e.target.value as Sortierung })}
            className={feldKlasse}
          >
            {SORTIERUNGEN.map((s) => (
              <option key={s} value={s}>
                {SORTIERUNG_LABEL[s]()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 font-medium">
          {m.per_page_label()}
          <select
            value={ansicht.proSeite}
            onChange={(e) => setAnsicht({ ...ansicht, proSeite: Number(e.target.value) })}
            className={feldKlasse}
          >
            {PRO_SEITE_WAHL.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {aktuelle ? (
          <p className="m-0 flex h-9 items-center text-muted" role="status">
            {m.views_current({ name: aktuelle.name })}
          </p>
        ) : (
          !speichern && (
            <button
              type="button"
              onClick={() => setSpeichern(true)}
              className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {m.views_save()}
            </button>
          )
        )}
      </div>
      {speichern && !aktuelle && (
        <form onSubmit={absenden} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1.5 font-medium">
            {m.views_name()}
            <input name="name" required maxLength={100} className={feldKlasse} />
          </label>
          {ich.data?.role === "inhaber" && (
            <label className="flex h-9 items-center gap-2">
              <input type="checkbox" name="fuerAlle" className="size-4" />
              {m.views_for_all()}
            </label>
          )}
          <button
            type="submit"
            disabled={anlegen.isPending}
            className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
          >
            {m.views_save_confirm()}
          </button>
          <button
            type="button"
            onClick={() => setSpeichern(false)}
            className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle"
          >
            {m.views_cancel()}
          </button>
          {anlegen.error && (
            <p role="alert" className="m-0 basis-full text-red-700 dark:text-red-400">
              {anlegen.error.message}
            </p>
          )}
        </form>
      )}
      {!!ansichten.data?.some((a) => a.eigene) && <SavedViews ansichten={ansichten.data} />}
    </div>
  );
}
