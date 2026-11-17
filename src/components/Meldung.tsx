import type { ReactNode } from "react";
import { m } from "../paraglide/messages.js";

/** Knopf der Meldung: gleiche Gestalt für „Erneut versuchen“ und den Link ins Archiv */
export const meldungKnopf =
  "inline-flex h-10 pointer-coarse:h-11 items-center rounded-md bg-primary px-4 font-medium text-onprimary text-base sm:text-sm";

/**
 * Meldung in drei Teilen (DESIGN.md): was ist passiert (Überschrift), ist etwas verloren (Satz), was kann man tun
 * (Knopf als children); der Rohtext steht eingeklappt unter „Details“, nie allein
 */
export function Meldung({
  was,
  verloren,
  details,
  children,
}: {
  was: string;
  verloren: string;
  details?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex max-w-xl flex-col items-start gap-3">
      <h1 className="m-0 font-semibold text-2xl tracking-tight">{was}</h1>
      <p className="m-0 text-muted text-sm">{verloren}</p>
      {children}
      {details ? (
        <details className="w-full min-w-0 text-sm">
          <summary className="inline-flex min-h-6 cursor-pointer items-center font-medium">
            {m.meldung_details()}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-muted text-xs">
            {details}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

export function ErneutVersuchen({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={meldungKnopf}>
      {m.offline_retry()}
    </button>
  );
}
