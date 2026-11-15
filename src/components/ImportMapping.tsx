import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId } from "react";
import { api, type ImportZuordnung, type ZielArt } from "../lib/api.ts";
import { ARTEN, artLabel } from "../lib/arten.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Freiwillig braucht ein eigenes Datum und taugt deshalb nicht für eine Zuordnung */
const ZIELE = ARTEN.filter((a) => a.art !== "freiwillig");

const herkunft = (z: ImportZuordnung) => (z.art === "tag" ? m.paperless_mapping_tag() : m.paperless_mapping_doctype());

/** Dokumenttyp oder Tag aus Paperless-ngx → Art: passende Dokumente ordnet der Import gleich ein */
export function ImportMapping() {
  const id = useId();
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["import-zuordnungen"], queryFn: api.zuordnungen });
  const neu = () => queryClient.invalidateQueries({ queryKey: ["import-zuordnungen"] });
  const anlegen = useMutation({ mutationFn: api.zuordnungAnlegen, onSuccess: neu });
  const loeschen = useMutation({ mutationFn: api.zuordnungLoeschen, onSuccess: neu });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate(
      {
        art: f.get("art") === "tag" ? "tag" : "dokumenttyp",
        name: String(f.get("name") ?? ""),
        zielArt: String(f.get("zielArt")) as ZielArt,
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 id={`${id}-titel`} className="m-0 font-semibold text-sm">
        {m.paperless_mapping_title()}
      </h3>
      <p className="m-0 text-muted text-sm">{m.paperless_mapping_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.paperless_mapping_none()}</p>}
      <ul aria-labelledby={`${id}-titel`} className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((z) => (
          <li
            key={z.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm"
          >
            <span>{m.paperless_mapping_item({ art: herkunft(z), name: z.name, ziel: artLabel(z.zielArt) })}</span>
            <button
              type="button"
              onClick={() => loeschen.mutate(z.id)}
              className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
            >
              {m.paperless_mapping_remove({ name: z.name })}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={absenden}
        className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-end gap-3 rounded-lg border border-border p-3"
      >
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.paperless_mapping_kind()}
          <select name="art" className={feld} defaultValue="dokumenttyp">
            <option value="dokumenttyp">{m.paperless_mapping_doctype()}</option>
            <option value="tag">{m.paperless_mapping_tag()}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.paperless_mapping_name()}
          <input name="name" required maxLength={200} className={feld} />
        </label>
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.paperless_mapping_target()}
          <select name="zielArt" className={feld} defaultValue="beleg">
            {ZIELE.map((a) => (
              <option key={a.art} value={a.art}>
                {a.label()}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm">
          {m.paperless_mapping_add()}
        </button>
      </form>
      {(anlegen.error ?? loeschen.error) && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.paperless_failed({ meldung: (anlegen.error ?? loeschen.error)!.message })}
        </p>
      )}
    </div>
  );
}
