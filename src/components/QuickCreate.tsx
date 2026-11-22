import { type FormEvent, useEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import { feldKlasse } from "./FieldInput.tsx";

/**
 * „+ Neu“ neben einer Auswahl im Dokument: legt einen Tag, Korrespondenten oder Dokumenttyp an und setzt ihn gleich,
 * ohne auf die Seite Ordnung zu wechseln
 */
export function QuickCreate({
  was,
  anlegen,
}: {
  /** Was angelegt wird, etwa „Tag“ */
  was: string;
  anlegen: (name: string) => Promise<unknown>;
}) {
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const feld = useRef<HTMLInputElement>(null);
  // Nach „+ Neu“ steht der Fokus gleich im Namen
  useEffect(() => {
    if (offen) feld.current?.focus();
  }, [offen]);

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await anlegen(name);
      form.reset();
      setOffen(false);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setLaeuft(false);
    }
  }

  if (!offen)
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="h-9 self-start rounded-md px-2 font-medium text-muted text-sm hover:bg-subtle hover:text-fg"
      >
        + {m.quick_create({ was })}
      </button>
    );
  return (
    <form onSubmit={absenden} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5 font-medium">
        {m.quick_create_name({ was })}
        <input ref={feld} name="name" required maxLength={300} className={feldKlasse} />
      </label>
      <button
        type="submit"
        disabled={laeuft}
        className="h-9 rounded-md bg-primary px-3 font-medium text-onprimary disabled:opacity-60"
      >
        {m.quick_create_submit()}
      </button>
      <button
        type="button"
        onClick={() => setOffen(false)}
        className="h-9 rounded-md border border-border px-3 font-medium hover:bg-subtle"
      >
        {m.form_cancel()}
      </button>
      {fehler && (
        <p role="alert" className="m-0 w-full text-red-700 dark:text-red-400">
          {fehler}
        </p>
      )}
    </form>
  );
}
