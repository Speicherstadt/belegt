import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";

/** Rahmen eines Abschnitts unter Quellen und anderen Verwaltungsseiten: Titel, Text, Liste, Formular */
export const verwaltungsKarte = "flex flex-col gap-3 rounded-lg border border-border p-4";

/**
 * Formular, das erst auf „+ …“ erscheint: Eine Seite zeigt zuerst, was es gibt, nicht leere Felder. Gesteuert vom
 * Abschnitt, damit er es nach dem Anlegen schließt
 */
export function Ausklappbar({
  label,
  offen,
  setOffen,
  children,
}: {
  label: string;
  offen: boolean;
  setOffen: (ja: boolean) => void;
  children: ReactNode;
}) {
  if (!offen)
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="h-9 self-start rounded-md border border-border px-3 font-medium text-sm hover:bg-subtle"
      >
        + {label}
      </button>
    );
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-subtle/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-sm">{label}</span>
        <button
          type="button"
          onClick={() => setOffen(false)}
          className="h-8 rounded-md px-2.5 text-muted text-sm hover:bg-subtle hover:text-fg"
        >
          {m.form_cancel()}
        </button>
      </div>
      {children}
    </div>
  );
}
