import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { darfBearbeiten } from "../../shared/rollen.ts";
import { api, type Feld, type Ordnung, type OrdnungAenderung } from "../lib/api.ts";
import { feldwertText } from "../lib/ordnung.ts";
import { m } from "../paraglide/messages.js";
import { ausEingabe, FieldInput, feldKlasse } from "./FieldInput.tsx";
import { PartyChip } from "./PartyChip.tsx";
import { TagChip } from "./TagChip.tsx";

/** Bezeichnung eines Feldes; ein Betrag nennt die Währung */
export const feldLabel = (f: Feld) => (f.typ === "betrag" ? `${f.name} (EUR)` : f.name);

/**
 * Korrespondent, Tags, Dokumenttyp und eigene Felder eines Dokuments: für alle lesbar, für den Inhaber änderbar. Metadaten, nicht das
 * Original; jede Änderung steht im Verlauf.
 */
export function DocumentOrdnung({
  dokumentId,
  ordnung,
  geloescht,
}: {
  dokumentId: string;
  ordnung: Ordnung;
  geloescht: boolean;
}) {
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const schreiben = darfBearbeiten(ich.data) && !geloescht;
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const typen = useQuery({ queryKey: ["dokumenttypen"], queryFn: api.dokumenttypen });
  const korrespondenten = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten, enabled: schreiben });
  const felder = useQuery({ queryKey: ["felder"], queryFn: api.felder });
  const queryClient = useQueryClient();
  const [ungueltig, setUngueltig] = useState<string | null>(null);
  const aendern = useMutation({
    mutationFn: (a: OrdnungAenderung) => api.ordnen(dokumentId, a),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const zugewiesen = new Set(ordnung.tags.map((t) => t.id));
  const frei = tags.data?.filter((t) => !zugewiesen.has(t.id)) ?? [];
  const wertJeFeld = new Map(ordnung.felder.map((f) => [f.feldId, f.wert]));

  function tagHinzu(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = String(new FormData(e.currentTarget).get("tag") ?? "");
    if (id) aendern.mutate({ tagsHinzu: [id] });
  }

  function feldSpeichern(e: FormEvent<HTMLFormElement>, feld: Feld) {
    e.preventDefault();
    const wert = ausEingabe(feld, String(new FormData(e.currentTarget).get("wert") ?? ""));
    if (wert === undefined) {
      setUngueltig(feld.id);
      return;
    }
    setUngueltig(null);
    aendern.mutate({ felder: [{ feldId: feld.id, wert }] });
  }

  return (
    <section aria-labelledby="ordnung" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="ordnung" className="m-0 font-semibold text-base">
        {m.order_title()}
      </h2>
      <div className="flex flex-col gap-2 text-sm">
        <h3 className="m-0 font-medium text-muted text-sm">{m.order_tags()}</h3>
        {ordnung.tags.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={m.order_tags()}>
            {ordnung.tags.map((t) => (
              <li key={t.id} className="max-w-full">
                <TagChip tag={t} onEntfernen={schreiben ? () => aendern.mutate({ tagsWeg: [t.id] }) : undefined} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-muted">{m.order_no_tags()}</p>
        )}
        {schreiben && frei.length > 0 && (
          <form onSubmit={tagHinzu} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-col gap-1.5 font-medium">
              {m.order_tag_add_label()}
              <select name="tag" className={feldKlasse}>
                {frei.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle">
              {m.order_tag_add()}
            </button>
          </form>
        )}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        {schreiben && korrespondenten.data?.length ? (
          <label className="flex flex-col gap-1.5 font-medium">
            {m.order_party()}
            <select
              value={ordnung.korrespondent?.id ?? ""}
              onChange={(e) => aendern.mutate({ korrespondent: e.target.value || null })}
              className={feldKlasse}
            >
              <option value="">{m.order_party_none()}</option>
              {korrespondenten.data.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0 flex flex-wrap items-center gap-1.5">
            <span className="text-muted">{m.order_party()}: </span>
            {ordnung.korrespondent ? <PartyChip korrespondent={ordnung.korrespondent} /> : m.order_party_none()}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        {schreiben && typen.data?.length ? (
          <label className="flex flex-col gap-1.5 font-medium">
            {m.order_doctype()}
            <select
              value={ordnung.dokumenttyp?.id ?? ""}
              onChange={(e) => aendern.mutate({ dokumenttyp: e.target.value || null })}
              className={feldKlasse}
            >
              <option value="">{m.order_doctype_none()}</option>
              {typen.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0">
            <span className="text-muted">{m.order_doctype()}: </span>
            {ordnung.dokumenttyp?.name ?? m.order_doctype_none()}
          </p>
        )}
      </div>
      {schreiben
        ? !!felder.data?.length && (
            <div className="flex flex-col gap-2 text-sm">
              <h3 className="m-0 font-medium text-muted text-sm">{m.order_fields()}</h3>
              {felder.data.map((f) => (
                <form
                  key={`${f.id}:${String(wertJeFeld.get(f.id) ?? "")}`}
                  onSubmit={(e) => feldSpeichern(e, f)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <label
                    htmlFor={`feld-${f.id}`}
                    className="flex w-full flex-col gap-1.5 font-medium sm:w-auto sm:flex-1"
                  >
                    {feldLabel(f)}
                    <FieldInput id={`feld-${f.id}`} feld={f} name="wert" wert={wertJeFeld.get(f.id)} />
                  </label>
                  <button
                    type="submit"
                    aria-label={m.order_field_save({ name: f.name })}
                    className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle"
                  >
                    {m.save()}
                  </button>
                  {ungueltig === f.id && (
                    <p role="alert" className="m-0 w-full text-red-700 dark:text-red-400">
                      {f.typ === "betrag" ? m.order_field_invalid_amount() : m.order_field_invalid()}
                    </p>
                  )}
                </form>
              ))}
            </div>
          )
        : ordnung.felder.length > 0 && (
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              {ordnung.felder.map((f) => (
                <div key={f.feldId} className="contents">
                  <dt className="text-muted">{f.name}</dt>
                  <dd className="m-0 break-words">
                    {f.typ === "link" ? (
                      <a href={String(f.wert)} target="_blank" rel="noopener noreferrer" className="underline">
                        {String(f.wert)}
                      </a>
                    ) : (
                      feldwertText(f.typ, f.wert)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
      {aendern.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.order_failed({ meldung: aendern.error.message })}
        </p>
      )}
    </section>
  );
}
