import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Konto } from "../lib/api.ts";
import { tag } from "../lib/format.ts";
import { m } from "../paraglide/messages.js";

const feld = "h-9 rounded-md border border-border bg-bg px-3 font-normal";
const knopf = "h-8 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle";
const primaer = "h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary text-sm disabled:opacity-60";
/** In einer Formularzeile mit items-end: ohne self-start, sonst steht der Knopf höher als die Felder */
const primaerZeile = primaer.replace(" self-start", "");

/** Backup-Codes einmal zeigen, als Textdatei zum Herunterladen; Belegt zeigt sie danach nie wieder */
export function BackupCodes({ codes, schliessen }: { codes: string[]; schliessen: () => void }) {
  const herunterladen = () => {
    const text = `${m.account_backup_file_title()}\n${window.location.origin}\n\n${codes.join("\n")}\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = "belegt-backup-codes.txt";
    a.click();
    // Erst nach dem Start des Downloads freigeben
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  return (
    <div role="status" className="flex flex-col gap-3 rounded-md border border-border bg-subtle p-3 text-sm">
      <p className="m-0 font-medium">{m.account_backup_title()}</p>
      <p className="m-0">{m.account_backup_hint()}</p>
      <ul aria-label={m.account_backup_title()} className="m-0 grid list-none grid-cols-2 gap-1 p-0 font-mono">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={herunterladen} className={knopf}>
          {m.account_backup_download()}
        </button>
        <button type="button" onClick={schliessen} className={knopf}>
          {m.account_backup_done()}
        </button>
      </div>
    </div>
  );
}

function PasskeyZeile({ p }: { p: Konto["passkeys"][number] }) {
  const queryClient = useQueryClient();
  const [umbenennen, setUmbenennen] = useState(false);
  const neu = () => queryClient.invalidateQueries({ queryKey: ["konto"] });
  const speichern = useMutation({
    mutationFn: (name: string) => api.passkeyUmbenennen(p.id, name),
    onSuccess: async () => {
      setUmbenennen(false);
      await neu();
    },
  });
  const entfernen = useMutation({ mutationFn: () => api.passkeyEntfernen(p.id), onSuccess: neu });
  const name = p.name || m.account_passkey_unnamed();
  const fehler = speichern.error ?? entfernen.error;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        {p.erstelltAm && <span className="text-muted">{m.account_passkey_added({ datum: tag(p.erstelltAm) })}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={umbenennen}
          aria-label={m.account_passkey_rename_named({ name })}
          onClick={() => setUmbenennen(!umbenennen)}
          className={knopf}
        >
          {m.account_passkey_rename()}
        </button>
        <button
          type="button"
          aria-label={m.account_passkey_remove_named({ name })}
          onClick={() => entfernen.mutate()}
          className={knopf}
        >
          {m.account_passkey_remove()}
        </button>
      </div>
      {umbenennen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            speichern.mutate(String(new FormData(e.currentTarget).get("name")).trim());
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1.5 font-medium">
            {m.account_passkey_name()}
            <input name="name" required maxLength={60} defaultValue={p.name ?? ""} className={feld} />
          </label>
          <button type="submit" className={primaerZeile}>
            {m.access_save()}
          </button>
        </form>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {fehler.message}
        </p>
      )}
    </li>
  );
}

/**
 * Passkeys des eigenen Kontos. Gilt die Pflicht und die Sitzung hat noch keinen zweiten Faktor, meldet Belegt nach dem
 * Hinzufügen gleich mit dem neuen Passkey an; erst diese Sitzung zählt als mit zweitem Faktor.
 */
export function Passkeys({ passkeys, einrichten }: { passkeys: Konto["passkeys"]; einrichten: boolean }) {
  const queryClient = useQueryClient();
  const hinzufuegen = useMutation({
    mutationFn: async (name: string) => {
      await api.passkeyHinzufuegen(name);
      if (einrichten) await api.passkeyAnmelden();
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div className="flex flex-col gap-3">
      {passkeys.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {passkeys.map((p) => (
            <PasskeyZeile key={p.id} p={p} />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-muted text-sm">{m.account_passkeys_none()}</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          hinzufuegen.mutate(String(new FormData(form).get("name")).trim(), { onSuccess: () => form.reset() });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1.5 font-medium text-sm">
          {m.account_passkey_name()}
          <input name="name" required maxLength={60} placeholder={m.account_passkey_placeholder()} className={feld} />
        </label>
        <button type="submit" disabled={hinzufuegen.isPending} className={primaerZeile}>
          {m.account_passkey_add()}
        </button>
      </form>
      {hinzufuegen.error && (
        <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
          {hinzufuegen.error.message}
        </p>
      )}
    </div>
  );
}
