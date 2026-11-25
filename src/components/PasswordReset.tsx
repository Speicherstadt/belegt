import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Einmalwert } from "./Einmalwert.tsx";

/** Meldung im Dialog in drei Teilen (DESIGN.md): was ist passiert, ist etwas verloren, Handlung ist der Knopf des Dialogs */
export function ResetFehler({ details }: { details: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 font-medium">{m.access_pw_reset_error_title()}</p>
      <p className="m-0 text-muted">{m.access_pw_reset_error_text()}</p>
      <details>
        <summary className="inline-flex min-h-6 cursor-pointer items-center font-medium">{m.meldung_details()}</summary>
        <pre className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-muted text-xs">{details}</pre>
      </details>
    </div>
  );
}

/** Der Link einmal; der Satz steht in eigener Live-Region neben ihm, nie mit dem Link darin */
export function ResetErgebnis({ email, link }: { email: string; link: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p role="status" className="m-0">
        {m.access_pw_reset_done({ email })}
      </p>
      <Einmalwert label={m.access_pw_reset_link({ email })} wert={link} />
    </div>
  );
}

/** Passwort eines Zugangs zurücksetzen: Rückfrage, dann der Link einmal (docs/zugaenge.md#passwort-vergessen) */
export function PasswordReset({ id, email, knopf }: { id: string; email: string; knopf: string }) {
  const [frage, setFrage] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const erstellen = useMutation({
    mutationFn: () => api.passwortZuruecksetzen(id),
    onSuccess: ({ pfad }) => {
      setFrage(false);
      setLink(`${window.location.origin}${pfad}`);
    },
  });
  return (
    <>
      <button
        type="button"
        aria-label={m.access_pw_reset_named({ email })}
        onClick={() => setFrage(true)}
        className={knopf}
      >
        {m.access_pw_reset()}
      </button>
      <ConfirmDialog
        open={frage}
        titel={m.access_pw_reset_title({ email })}
        folge={m.access_pw_reset_follow()}
        verb={m.access_pw_reset_verb()}
        pending={erstellen.isPending}
        fehler={erstellen.error ? <ResetFehler details={erstellen.error.message} /> : undefined}
        onConfirm={() => erstellen.mutate()}
        onCancel={() => {
          setFrage(false);
          erstellen.reset();
        }}
      />
      {link && (
        <div className="basis-full">
          <ResetErgebnis email={email} link={link} />
        </div>
      )}
    </>
  );
}
