import { useEffect, useRef } from "react";
import { dateiUrl } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

/** Ob die Vorschau im Browser geht: PDF und gängige Bilder */
export const hatVorschau = (mimeType: string) =>
  mimeType === "application/pdf" || (mimeType.startsWith("image/") && mimeType !== "image/heic");

/**
 * Schnelle Vorschau aus der Liste: ein Dialog mit dem Original, ohne die Liste zu verlassen. Escape oder „Schließen“
 * führen zurück, der Fokus geht dann an den Knopf, der ihn geöffnet hat (natives dialog)
 */
export function PreviewDialog({
  dokument,
  titel,
  onClose,
}: {
  dokument: { id: string; mimeType: string };
  titel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={m.preview_title({ name: titel })}
      className="m-auto h-[90vh] w-[min(56rem,95vw)] rounded-lg border border-border bg-bg p-0 text-fg backdrop:bg-black/50"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-border border-b px-4 py-2">
          <span className="min-w-0 truncate font-medium text-sm">{titel}</span>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="h-9 rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
          >
            {m.drop_close()}
          </button>
        </div>
        {dokument.mimeType === "application/pdf" ? (
          <iframe title={titel} src={dateiUrl(dokument.id, true)} className="min-h-0 w-full flex-1 bg-white" />
        ) : (
          <img
            src={dateiUrl(dokument.id, true)}
            alt={titel}
            className="m-auto min-h-0 max-w-full flex-1 object-contain p-4"
          />
        )}
      </div>
    </dialog>
  );
}
