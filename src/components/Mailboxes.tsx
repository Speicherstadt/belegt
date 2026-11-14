import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { darfSchreiben } from "../../shared/rollen.ts";
import { api } from "../lib/api.ts";
import { zeitpunkt } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";

/** Postfächer für den IMAP-Abruf: Liste mit Stand, hinzufügen, jetzt abrufen */
export function Mailboxes() {
  const queryClient = useQueryClient();
  const ich = useQuery({ queryKey: ["ich"], queryFn: api.ich });
  const liste = useQuery({ queryKey: ["quellen"], queryFn: api.quellen });
  const neu = () => queryClient.invalidateQueries();
  const anlegen = useMutation({ mutationFn: api.quelleAnlegen, onSuccess: neu });
  const abrufen = useMutation({ mutationFn: api.quelleAbrufen, onSettled: neu });
  const schreiben = darfSchreiben(ich.data?.role);
  const [art, setArt] = useState<"imap" | "jmap">("imap");

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    anlegen.mutate(
      {
        name: String(f.get("name")),
        host: String(f.get("host")),
        port: Number(f.get("port")),
        tls: f.get("tls") === "on",
        benutzer: String(f.get("benutzer")),
        passwort: String(f.get("passwort")),
        ordner: String(f.get("ordner")),
        art,
      },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section aria-labelledby="postfaecher" className="flex flex-col gap-3">
      <h2 id="postfaecher" className="m-0 font-semibold text-base">
        {m.mailboxes_title()}
      </h2>
      <p className="m-0 text-muted text-sm">{m.mailboxes_intro()}</p>
      {liste.data?.length === 0 && <p className="m-0 text-sm">{m.mailboxes_none()}</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {liste.data?.map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
          >
            <span className="flex flex-col">
              <span className="font-medium">
                {q.name} · {q.art === "jmap" ? "JMAP" : "IMAP"} · {q.benutzer}@{q.host}:{q.port}/{q.ordner}
              </span>
              <span className="text-muted">
                {q.letzterAbruf ? m.mailboxes_last({ wann: zeitpunkt(q.letzterAbruf) }) : m.mailboxes_never()}
              </span>
              {q.letzterFehler && (
                <span className="text-red-700 dark:text-red-400">
                  {m.mailboxes_error({ meldung: q.letzterFehler })}
                </span>
              )}
            </span>
            {schreiben && (
              <button
                type="button"
                onClick={() => abrufen.mutate(q.id)}
                disabled={abrufen.isPending}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle disabled:opacity-60"
              >
                {m.mailboxes_fetch()}
              </button>
            )}
          </li>
        ))}
      </ul>
      {abrufen.data && !abrufen.data.fehler && (
        <p role="status" className="m-0 text-sm">
          {m.mailboxes_result({ neu: String(abrufen.data.neu), doppelt: String(abrufen.data.doppelt) })}
        </p>
      )}
      {schreiben && (
        <form
          onSubmit={absenden}
          className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] items-end gap-3 rounded-lg border border-border p-3"
        >
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_name()}
            <input name="name" required className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_kind()}
            <select value={art} onChange={(e) => setArt(e.target.value as typeof art)} className={feld}>
              <option value="imap">IMAP</option>
              <option value="jmap">JMAP</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_host()}
            <input name="host" required className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_port()}
            <input
              key={art}
              name="port"
              type="number"
              required
              min={1}
              max={65535}
              defaultValue={art === "jmap" ? 443 : 993}
              className={feld}
            />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_user()}
            <input name="benutzer" required autoComplete="off" className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_password()}
            <input name="passwort" type="password" required autoComplete="new-password" className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium text-sm">
            {m.mailboxes_folder()}
            <input name="ordner" required defaultValue="INBOX" className={feld} />
          </label>
          <label className="flex h-9 items-center gap-2 font-medium text-sm">
            <input name="tls" type="checkbox" defaultChecked className="size-4" />
            {m.mailboxes_tls()}
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary text-sm">
            {m.mailboxes_create()}
          </button>
        </form>
      )}
      {(anlegen.error ?? abrufen.error) && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {m.mailboxes_failed({ meldung: (anlegen.error ?? abrufen.error)!.message })}
        </p>
      )}
    </section>
  );
}
