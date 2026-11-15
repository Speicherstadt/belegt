import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api, type Korrespondent } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";
import { MatchingRule, regelAus, regelText } from "./MatchingRule.tsx";
import { archivSuche } from "./PartyChip.tsx";

const knopf = "h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle";

/**
 * Ein Korrespondent: anzeigen (mit Link ins Archiv), umbenennen und Regel ändern, mit einem anderen zusammenführen,
 * löschen (nur ohne Dokumente)
 */
function KorrespondentZeile({ k, alle, schreiben }: { k: Korrespondent; alle: Korrespondent[]; schreiben: boolean }) {
  const queryClient = useQueryClient();
  const [modus, setModus] = useState<"bearbeiten" | "zusammenfuehren" | null>(null);
  const [loeschen, setLoeschen] = useState(false);
  const neu = () => queryClient.invalidateQueries();
  const aendern = useMutation({
    mutationFn: (e: Parameters<typeof api.korrespondentAendern>[1]) => api.korrespondentAendern(k.id, e),
    onSuccess: () => {
      setModus(null);
      return neu();
    },
  });
  const zusammen = useMutation({
    mutationFn: (ziel: string) => api.zusammenfuehren(k.id, ziel),
    onSuccess: neu,
  });
  const weg = useMutation({ mutationFn: () => api.korrespondentLoeschen(k.id), onSuccess: neu });
  const fehler = aendern.error ?? zusammen.error ?? weg.error;

  function speichern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    aendern.mutate({ name: String(f.get("name")), ...regelAus(f) });
  }

  function zusammenfuehren(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ziel = String(new FormData(e.currentTarget).get("ziel") ?? "");
    if (ziel) zusammen.mutate(ziel);
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <Link to="/archiv" search={archivSuche(k.id)} className="break-words font-medium underline">
            {k.name}
          </Link>
          <span className="text-muted">
            {m.order_count({ anzahl: String(k.anzahl) })} · {regelText(k)}
          </span>
        </span>
        {schreiben && (
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={modus === "bearbeiten"}
              aria-label={m.order_edit_named({ name: k.name })}
              onClick={() => setModus(modus === "bearbeiten" ? null : "bearbeiten")}
              className={knopf}
            >
              {m.order_edit()}
            </button>
            {alle.length > 1 && (
              <button
                type="button"
                aria-expanded={modus === "zusammenfuehren"}
                aria-label={m.party_merge_named({ name: k.name })}
                onClick={() => setModus(modus === "zusammenfuehren" ? null : "zusammenfuehren")}
                className={knopf}
              >
                {m.party_merge()}
              </button>
            )}
            {loeschen ? (
              <button
                type="button"
                onClick={() => weg.mutate()}
                className="h-8 rounded-md bg-red-700 px-3 font-medium text-white"
              >
                {m.order_delete_confirm({ name: k.name })}
              </button>
            ) : (
              <button
                type="button"
                aria-label={m.order_delete_named({ name: k.name })}
                onClick={() => setLoeschen(true)}
                className={knopf}
              >
                {m.order_delete()}
              </button>
            )}
          </span>
        )}
      </div>
      {modus === "bearbeiten" && (
        <form onSubmit={speichern} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_name()}
            <input name="name" required maxLength={300} defaultValue={k.name} className={feldKlasse} />
          </label>
          <MatchingRule id={`regel-${k.id}`} wert={k} />
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.save()}
          </button>
        </form>
      )}
      {modus === "zusammenfuehren" && (
        <form onSubmit={zusammenfuehren} className="flex flex-wrap items-end gap-2">
          <label htmlFor={`ziel-${k.id}`} className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.party_merge_into({ name: k.name })}
            <select id={`ziel-${k.id}`} name="ziel" className={feldKlasse}>
              {alle
                .filter((x) => x.id !== k.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.party_merge_submit()}
          </button>
          <p className="m-0 w-full text-muted text-xs">{m.party_merge_hint()}</p>
        </form>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {m.order_failed({ meldung: fehler.message })}
        </p>
      )}
    </li>
  );
}

/** Korrespondenten als Liste: anlegen mit Zuordnungsregel, umbenennen, zusammenführen, löschen */
export function CorrespondentsAdmin({ schreiben }: { schreiben: boolean }) {
  const queryClient = useQueryClient();
  const liste = useQuery({ queryKey: ["korrespondenten"], queryFn: api.korrespondenten });
  const anlegen = useMutation({
    mutationFn: api.korrespondentAnlegen,
    onSuccess: () => queryClient.invalidateQueries(),
  });
  // Nach dem Anlegen ein frisches Formular, auch für die Regel
  const [runde, setRunde] = useState(0);

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    anlegen.mutate({ name: String(f.get("name")), ...regelAus(f) }, { onSuccess: () => setRunde(runde + 1) });
  }

  return (
    <section aria-labelledby="korrespondenten" className="flex flex-col gap-3">
      <h2 id="korrespondenten" className="m-0 font-semibold text-base">
        {m.order_parties()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.order_parties_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.order_parties_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((k) => (
          <KorrespondentZeile key={k.id} k={k} alle={liste.data} schreiben={schreiben} />
        ))}
      </ul>
      {schreiben && (
        <form
          key={runde}
          onSubmit={absenden}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <label className="flex min-w-0 flex-col gap-1.5 font-medium">
            {m.order_party_name()}
            <input name="name" required maxLength={300} className={feldKlasse} />
          </label>
          <MatchingRule id="regel-korrespondent-neu" />
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary">
            {m.order_party_create()}
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
