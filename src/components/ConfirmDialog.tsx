import { useEffect, useId, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";

/**
 * Rückfrage vor Endgültigem mit dem nativen `<dialog>`: Fokusfalle, Escape und die Rückkehr des Fokus zum auslösenden
 * Knopf liefert der Browser. Mit `haken` (Stufe 2) gilt Bestätigen erst bei gesetztem Häkchen.
 */
export function ConfirmDialog({
  open,
  titel,
  folge,
  verb,
  haken,
  pending,
  fehler,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  titel: string;
  folge: string;
  verb: string;
  haken?: string;
  pending?: boolean;
  fehler?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const abbrechen = useRef<HTMLButtonElement>(null);
  const [gesetzt, setGesetzt] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setGesetzt(false);
      d.showModal();
      // Der Fokus startet auf dem harmlosen Knopf, nicht auf dem Endgültigen
      abbrechen.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-titel`}
      aria-describedby={`${id}-folge`}
      // Escape: Der Elternteil schließt über `open`, sonst liefen Anzeige und Zustand auseinander
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border border-border bg-bg p-5 text-fg backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-3">
        <h2 id={`${id}-titel`} className="m-0 font-semibold text-lg">
          {titel}
        </h2>
        <p id={`${id}-folge`} className="m-0 text-sm">
          {folge}
        </p>
        {haken && (
          <label className="flex items-start gap-2 font-medium text-sm">
            <input
              type="checkbox"
              checked={gesetzt}
              onChange={(e) => setGesetzt(e.target.checked)}
              className="mt-0.5 size-4 shrink-0"
            />
            {haken}
          </label>
        )}
        {fehler && (
          <p role="alert" className="m-0 text-red-700 text-sm dark:text-red-400">
            {fehler}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            ref={abbrechen}
            type="button"
            onClick={onCancel}
            className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
          >
            {m.confirm_cancel()}
          </button>
          <button
            type="button"
            disabled={pending || (!!haken && !gesetzt)}
            onClick={onConfirm}
            className="h-9 rounded-md bg-red-700 px-4 font-medium text-sm text-white disabled:opacity-60"
          >
            {verb}
          </button>
        </div>
      </div>
    </dialog>
  );
}
