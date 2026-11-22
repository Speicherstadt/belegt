import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type Art, api, type Dokumenttyp } from "../lib/api.ts";
import { ARTEN, artLabel } from "../lib/arten.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";
import { MatchingRule, regelAus, regelText } from "./MatchingRule.tsx";

function ArtAuswahl({ id, wert }: { id: string; wert?: Art | null }) {
  return (
    <select id={id} name="vorgabeArt" defaultValue={wert ?? ""} className={feldKlasse}>
      <option value="">{m.order_default_kind_none()}</option>
      {ARTEN.map((a) => (
        <option key={a.art} value={a.art}>
          {a.label()}
        </option>
      ))}
    </select>
  );
}

const artAus = (f: FormData) => (String(f.get("vorgabeArt") ?? "") || null) as Art | null;

function TypZeile({ typ, schreiben }: { typ: Dokumenttyp; schreiben: boolean }) {
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [loeschen, setLoeschen] = useState(false);
  const neu = () => queryClient.invalidateQueries();
  const aendern = useMutation({
    mutationFn: (t: Parameters<typeof api.dokumenttypAendern>[1]) => api.dokumenttypAendern(typ.id, t),
    onSuccess: () => {
      setBearbeiten(false);
      return neu();
    },
  });
  const weg = useMutation({ mutationFn: () => api.dokumenttypLoeschen(typ.id), onSuccess: neu });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    aendern.mutate({ name: String(f.get("name")), vorgabeArt: artAus(f), ...regelAus(f) });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-medium">{typ.name}</span>
          <span className="text-muted">
            {typ.vorgabeArt ? m.order_default_kind({ art: artLabel(typ.vorgabeArt) }) : m.order_default_kind_none()} ·{" "}
            {m.order_count({ anzahl: String(typ.anzahl) })} · {regelText(typ)}
          </span>
        </span>
        {schreiben && (
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={bearbeiten}
              aria-label={m.order_edit_named({ name: typ.name })}
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
                {m.order_delete_confirm({ name: typ.name })}
              </button>
            ) : (
              <button
                type="button"
                aria-label={m.order_delete_named({ name: typ.name })}
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
            <input name="name" required maxLength={100} defaultValue={typ.name} className={feldKlasse} />
          </label>
          <label htmlFor={`art-${typ.id}`} className="flex flex-col gap-1.5 font-medium">
            {m.order_default_kind_label()}
            <ArtAuswahl id={`art-${typ.id}`} wert={typ.vorgabeArt} />
          </label>
          <MatchingRule id={`regel-${typ.id}`} wert={typ} />
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

/** Dokumenttypen: frei definierbar, getrennt von der Art; die Vorgabe-Art schlägt beim Einordnen nur vor */
export function DoctypesAdmin({ schreiben, filter = "" }: { schreiben: boolean; filter?: string }) {
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const anlegen = useMutation({
    mutationFn: api.dokumenttypAnlegen,
    onSuccess: () => queryClient.invalidateQueries(),
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate({ name: String(f.get("name")), vorgabeArt: artAus(f) }, { onSuccess: () => form.reset() });
  }

  return (
    <section aria-labelledby="dokumenttypen" className="flex flex-col gap-3">
      <h2 id="dokumenttypen" className="m-0 font-semibold text-base">
        {m.order_doctypes()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.order_doctypes_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.order_doctypes_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data
          ?.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase()))
          .map((t) => (
            <TypZeile key={t.id} typ={t} schreiben={schreiben} />
          ))}
      </ul>
      {schreiben && (
        <form
          onSubmit={absenden}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_doctype_name()}
            <input name="name" required maxLength={100} className={feldKlasse} />
          </label>
          <label htmlFor="art-neu" className="flex flex-col gap-1.5 font-medium">
            {m.order_default_kind_label()}
            <ArtAuswahl id="art-neu" />
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.order_doctype_create()}
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
