import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { FELDTYPEN, type Feldtyp } from "../../shared/ordnung.ts";
import { api, type Feld } from "../lib/api.ts";
import { FELDTYP_LABEL } from "../lib/ordnung.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

/** Optionen einer Auswahl, eine je Zeile */
const optionenAus = (f: FormData) =>
  String(f.get("optionen") ?? "")
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);

function FeldZeile({ feld, schreiben }: { feld: Feld; schreiben: boolean }) {
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [loeschen, setLoeschen] = useState(false);
  const neu = () => queryClient.invalidateQueries();
  const aendern = useMutation({
    mutationFn: (f: { name: string; optionen?: string[] }) => api.feldAendern(feld.id, f),
    onSuccess: () => {
      setBearbeiten(false);
      return neu();
    },
  });
  const weg = useMutation({ mutationFn: () => api.feldLoeschen(feld.id), onSuccess: neu });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    aendern.mutate({
      name: String(f.get("name")),
      ...(feld.typ === "auswahl" ? { optionen: optionenAus(f) } : {}),
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-medium">{feld.name}</span>
          <span className="text-muted">
            {FELDTYP_LABEL[feld.typ]()}
            {feld.typ === "auswahl" && `: ${feld.optionen.join(", ")}`}
          </span>
        </span>
        {schreiben && (
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={bearbeiten}
              aria-label={m.order_edit_named({ name: feld.name })}
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
                {m.order_field_delete_confirm({ name: feld.name })}
              </button>
            ) : (
              <button
                type="button"
                aria-label={m.order_delete_named({ name: feld.name })}
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
            <input name="name" required maxLength={100} defaultValue={feld.name} className={feldKlasse} />
          </label>
          {feld.typ === "auswahl" && (
            <label className="flex min-w-0 flex-col gap-1.5 font-medium">
              {m.order_field_options()}
              <textarea
                name="optionen"
                required
                rows={3}
                defaultValue={feld.optionen.join("\n")}
                className="rounded-md border border-border bg-bg px-3 py-2 font-normal"
              />
            </label>
          )}
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

/** Eigene Felder: Typ bei der Anlage fest; Name und Optionen einer Auswahl lassen sich ändern */
export function FieldsAdmin({ schreiben }: { schreiben: boolean }) {
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["felder"], queryFn: api.felder });
  const [typ, setTyp] = useState<Feldtyp>("text");
  const anlegen = useMutation({ mutationFn: api.feldAnlegen, onSuccess: () => queryClient.invalidateQueries() });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate(
      { name: String(f.get("name")), typ, optionen: typ === "auswahl" ? optionenAus(f) : [] },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section aria-labelledby="felder" className="flex flex-col gap-3">
      <h2 id="felder" className="m-0 font-semibold text-base">
        {m.order_fields()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.order_fields_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.order_fields_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((f) => (
          <FeldZeile key={f.id} feld={f} schreiben={schreiben} />
        ))}
      </ul>
      {schreiben && (
        <form
          onSubmit={absenden}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_field_name()}
            <input name="name" required maxLength={100} className={feldKlasse} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            {m.order_field_type()}
            <select value={typ} onChange={(e) => setTyp(e.target.value as Feldtyp)} className={feldKlasse}>
              {FELDTYPEN.map((t) => (
                <option key={t} value={t}>
                  {FELDTYP_LABEL[t]()}
                </option>
              ))}
            </select>
          </label>
          {typ === "auswahl" && (
            <label className="flex min-w-0 flex-col gap-1.5 font-medium">
              {m.order_field_options()}
              <textarea
                name="optionen"
                required
                rows={3}
                className="rounded-md border border-border bg-bg px-3 py-2 font-normal"
              />
            </label>
          )}
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.order_field_create()}
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
