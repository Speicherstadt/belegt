import { CircleX } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { m } from "../paraglide/messages.js";

/** Knopf der Meldung: gleiche Gestalt für „Erneut versuchen“ und den Link ins Archiv */
export const meldungKnopf =
  "inline-flex h-10 pointer-coarse:h-11 items-center rounded-md bg-primary px-4 font-medium text-onprimary text-base sm:text-sm";

/**
 * Meldung in drei Teilen (DESIGN.md): was ist passiert (Überschrift), ist etwas verloren (Satz), was kann man tun
 * (Knopf als children); der Rohtext steht eingeklappt unter „Details“, nie allein. `eingebettet` (in einer Karte oder
 * einem Formular): Hinweis-Kasten mit `role="alert"`, der Titel ein `p` mit Symbol; `huelle` bekommt den Fokus.
 */
export function Meldung({
  was,
  verloren,
  details,
  children,
  eingebettet,
  titelId,
  huelle,
}: {
  was: string;
  verloren: string;
  details?: string;
  children: ReactNode;
  eingebettet?: boolean;
  /** Nur eingebettet: `id` des Titels, auf die ein Feld per `aria-describedby` verweisen kann */
  titelId?: string;
  huelle?: Ref<HTMLDivElement>;
}) {
  const rohtext = details ? (
    <details className="w-full min-w-0 text-sm">
      <summary className="inline-flex min-h-10 pointer-coarse:min-h-11 cursor-pointer items-center font-medium">
        {m.meldung_details()}
      </summary>
      <pre className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-muted text-xs">{details}</pre>
    </details>
  ) : null;
  if (eingebettet)
    return (
      <div
        ref={huelle}
        role="alert"
        tabIndex={-1}
        className="flex flex-col items-start gap-3 rounded-lg bg-subtle p-4 text-sm md:col-span-2"
      >
        <p id={titelId} className="m-0 flex items-start gap-2 font-semibold text-base text-danger">
          <span className="flex h-6 items-center">
            <CircleX className="size-4" aria-hidden="true" />
          </span>
          {was}
        </p>
        <p className="m-0">{verloren}</p>
        {children}
        {rohtext}
      </div>
    );
  return (
    <section className="flex max-w-xl flex-col items-start gap-3">
      <h1 className="m-0 font-semibold text-2xl tracking-tight">{was}</h1>
      <p className="m-0 text-muted text-sm">{verloren}</p>
      {children}
      {rohtext}
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
