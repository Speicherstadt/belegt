import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useRef, useState } from "react";
import { ApiFehler, api, type Quelle, type QuelleAenderung } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";
const OAUTH = { microsoft: "Microsoft 365", google: "Google" } as const;

/** Nur Geändertes; das Passwort nur, wenn das Feld ausgefüllt ist (leer = bleibt). Bei OAuth nur Name und Ordner. */
export function quelleAenderung(q: Quelle, f: FormData): QuelleAenderung {
  const neu: QuelleAenderung = {
    name: String(f.get("name") ?? ""),
    ordner: String(f.get("ordner") ?? ""),
  };
  if (!q.oauth) {
    neu.host = String(f.get("host") ?? "");
    neu.port = Number(f.get("port"));
    neu.tls = f.get("tls") === "on";
    neu.benutzer = String(f.get("benutzer") ?? "");
    const passwort = String(f.get("passwort") ?? "");
    if (passwort) neu.passwort = passwort;
  }
  const geaendert = Object.entries(neu).filter(([k, v]) => k === "passwort" || q[k as keyof Quelle] !== v);
  return Object.fromEntries(geaendert);
}

/** Ändert sich, woher abgeholt wird, oder geht TLS aus, muss das Passwort neu eingegeben werden (der Server schickt es nicht mit) */
export function passwortNoetig(q: Quelle, f: FormData): boolean {
  return (
    !q.oauth &&
    (String(f.get("host") ?? "") !== q.host ||
      Number(f.get("port")) !== q.port ||
      String(f.get("benutzer") ?? "") !== q.benutzer ||
      (q.tls && f.get("tls") === null))
  );
}

/** Formular im Eintrag: vorbelegt, das Passwort bleibt leer und wird nie angezeigt */
export function MailboxEditForm({ quelle, fertig, id: formId }: { quelle: Quelle; fertig: () => void; id?: string }) {
  const id = useId();
  const [noetig, setNoetig] = useState(false);
  const queryClient = useQueryClient();
  const speichern = useMutation({
    mutationFn: (e: QuelleAenderung) => api.quelleAendern(quelle.id, e),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quellen"] });
      fertig();
    },
  });

  function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const aenderung = quelleAenderung(quelle, new FormData(e.currentTarget));
    if (Object.keys(aenderung).length === 0) fertig();
    else speichern.mutate(aenderung);
  }

  return (
    <form
      id={formId}
      onSubmit={absenden}
      onChange={(e) => setNoetig(passwortNoetig(quelle, new FormData(e.currentTarget)))}
      className="grid w-full items-end gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1.5 font-medium">
        {m.mailboxes_name()}
        <input name="name" required defaultValue={quelle.name} className={feld} />
      </label>
      {quelle.oauth ? (
        <p className="m-0 text-muted sm:col-span-2">{m.mailboxes_oauth_note({ anbieter: OAUTH[quelle.oauth] })}</p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 font-medium">
            {m.mailboxes_host()}
            <input name="host" required defaultValue={quelle.host} className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            {m.mailboxes_port()}
            <input name="port" type="number" required min={1} max={65535} defaultValue={quelle.port} className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            {m.mailboxes_user()}
            <input name="benutzer" required autoComplete="off" defaultValue={quelle.benutzer} className={feld} />
          </label>
          <label className="flex flex-col gap-1.5 font-medium">
            {m.mailboxes_password()}
            <input
              name="passwort"
              type="password"
              autoComplete="new-password"
              required={noetig}
              aria-describedby={`${id}-passwort`}
              className={feld}
            />
            <span id={`${id}-passwort`} className="font-normal text-muted">
              {noetig ? m.mailboxes_password_required() : m.mailboxes_password_keep()}
            </span>
          </label>
        </>
      )}
      <label className="flex flex-col gap-1.5 font-medium">
        {m.mailboxes_folder()}
        <input name="ordner" required defaultValue={quelle.ordner} className={feld} />
      </label>
      {!quelle.oauth && (
        <label className="flex h-9 items-center gap-2 font-medium">
          <input name="tls" type="checkbox" defaultChecked={quelle.tls} className="size-4" />
          {m.mailboxes_tls()}
        </label>
      )}
      <div className="col-span-full flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={fertig}
          disabled={speichern.isPending}
          className="h-9 rounded-md border border-border px-3 font-medium disabled:opacity-60"
        >
          {m.confirm_cancel()}
        </button>
        <button
          type="submit"
          disabled={speichern.isPending}
          className="h-9 rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
        >
          {m.save()}
        </button>
      </div>
      {speichern.error && (
        <p role="alert" className="col-span-full m-0 text-danger">
          {speichern.error.message}
        </p>
      )}
    </form>
  );
}

/** „Entfernen“ und „Ändern“ eines Postfachs (nur der Inhaber), mit Rückfrage vor dem Entfernen */
export function MailboxEdit({
  quelle,
  inhaber,
  nachEntfernen,
}: {
  quelle: Quelle;
  inhaber: boolean;
  /** Der Eintrag ist danach weg; der Elternteil setzt den Fokus an eine sinnvolle Stelle */
  nachEntfernen?: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [fragen, setFragen] = useState(false);
  const aendern = useRef<HTMLButtonElement>(null);
  const entfernen = useMutation({
    mutationFn: () => api.quelleEntfernen(quelle.id),
    onSuccess: async () => {
      setFragen(false);
      await queryClient.invalidateQueries({ queryKey: ["quellen"] });
      nachEntfernen?.();
    },
  });
  if (!inhaber) return null;

  const schliessen = () => {
    setBearbeiten(false);
    aendern.current?.focus();
  };
  const fehler = entfernen.error
    ? entfernen.error instanceof ApiFehler && entfernen.error.status === 409
      ? m.mailboxes_remove_blocked({ meldung: entfernen.error.message })
      : entfernen.error.message
    : undefined;

  return (
    <div className="flex w-full flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFragen(true)}
          aria-label={m.mailboxes_remove_named({ name: quelle.name })}
          className="h-10 pointer-coarse:h-11 rounded-md border border-danger px-3 font-medium text-danger hover:bg-subtle"
        >
          {m.mailboxes_remove()}
        </button>
        <button
          ref={aendern}
          type="button"
          onClick={() => setBearbeiten(true)}
          aria-expanded={bearbeiten}
          aria-controls={bearbeiten ? formId : undefined}
          aria-label={m.mailboxes_edit_named({ name: quelle.name })}
          className="h-10 pointer-coarse:h-11 rounded-md border border-border px-3 font-medium hover:bg-subtle"
        >
          {m.mailboxes_edit()}
        </button>
      </div>
      {bearbeiten && <MailboxEditForm id={formId} quelle={quelle} fertig={schliessen} />}
      <ConfirmDialog
        open={fragen}
        titel={m.mailboxes_remove_title({ name: quelle.name })}
        folge={m.mailboxes_remove_follow()}
        verb={m.mailboxes_remove()}
        pending={entfernen.isPending}
        fehler={fehler}
        onConfirm={() => entfernen.mutate()}
        onCancel={() => {
          setFragen(false);
          entfernen.reset();
        }}
      />
    </div>
  );
}
